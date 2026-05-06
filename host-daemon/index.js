/**
 * DecentraStore — Host Daemon
 *
 * Run this on every storage host machine.
 * Hosts receive encrypted shards from renters, store them to disk,
 * and serve them back on demand.
 *
 * Usage:
 *   cd host-daemon
 *   npm install
 *   node index.js
 *
 * Env vars (optional):
 *   PORT        — listening port (default 3001)
 *   STORAGE_DIR — where shards are saved (default ./shards)
 *   API_SECRET  — shared secret for upload auth (optional but recommended)
 */

const express = require('express')
const cors    = require('cors')
const fs      = require('fs')
const path    = require('path')
const crypto  = require('crypto')

const app        = express()
const PORT       = process.env.PORT        || 3001
const STORAGE    = process.env.STORAGE_DIR || path.join(__dirname, 'shards')
const API_SECRET = process.env.API_SECRET  || null   // set this in production

// ── ensure shard storage directory exists ──────────────────────────────────
if (!fs.existsSync(STORAGE)) fs.mkdirSync(STORAGE, { recursive: true })

// ── middleware ──────────────────────────────────────────────────────────────
app.use(cors())
// raw body for binary shard uploads — up to 50 MB per shard
app.use('/shard', express.raw({ type: 'application/octet-stream', limit: '50mb' }))
app.use(express.json())

// ── optional auth check ─────────────────────────────────────────────────────
function checkAuth(req, res, next) {
  if (!API_SECRET) return next()
  const token = req.headers['x-api-secret']
  if (token !== API_SECRET) return res.status(401).json({ error: 'Unauthorized' })
  next()
}

// ── helpers ─────────────────────────────────────────────────────────────────
function shardPath(fileId, shardIndex) {
  // sanitise inputs so we can't be tricked into writing outside STORAGE
  const safeFileId    = fileId.replace(/[^a-zA-Z0-9_\-]/g, '')
  const safeShardIdx  = String(parseInt(shardIndex, 10))
  return path.join(STORAGE, `${safeFileId}_${safeShardIdx}.shard`)
}

function sha256hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

// ── routes ──────────────────────────────────────────────────────────────────

/**
 * Health check — Render.com / UptimeRobot pings this
 * GET /health
 */
app.get('/health', (req, res) => {
  const used  = fs.readdirSync(STORAGE).length
  const bytes = fs.readdirSync(STORAGE).reduce((acc, f) => {
    try { return acc + fs.statSync(path.join(STORAGE, f)).size } catch { return acc }
  }, 0)
  res.json({
    status:    'ok',
    shards:    used,
    storedMB:  (bytes / 1024 / 1024).toFixed(2),
    timestamp: new Date().toISOString()
  })
})

/**
 * Upload a shard — renter calls this after RS encode
 * POST /shard/:fileId/:shardIndex
 * Body: raw binary (application/octet-stream)
 * Headers: x-shard-hash — expected SHA-256 hex (from on-chain chunkHashes)
 */
app.post('/shard/:fileId/:shardIndex', checkAuth, (req, res) => {
  try {
    const { fileId, shardIndex } = req.params
    const data = req.body  // Buffer

    if (!Buffer.isBuffer(data) || data.length === 0) {
      return res.status(400).json({ error: 'Empty or invalid shard body' })
    }

    // verify SHA-256 if the renter provided the expected hash
    const expectedHash = req.headers['x-shard-hash']
    const actualHash   = sha256hex(data)

    if (expectedHash && expectedHash !== actualHash) {
      return res.status(400).json({
        error:    'Hash mismatch — shard rejected',
        expected: expectedHash,
        actual:   actualHash
      })
    }

    const dest = shardPath(fileId, shardIndex)
    fs.writeFileSync(dest, data)

    console.log(`[STORE] fileId=${fileId} shard=${shardIndex} size=${data.length}B hash=${actualHash.slice(0,16)}...`)

    res.json({
      ok:         true,
      shardIndex: parseInt(shardIndex),
      hash:       actualHash,
      bytes:      data.length
    })
  } catch (err) {
    console.error('[STORE ERROR]', err.message)
    res.status(500).json({ error: err.message })
  }
})

/**
 * Download a shard — renter calls this to reconstruct a file
 * GET /shard/:fileId/:shardIndex
 * Response: raw binary
 */
app.get('/shard/:fileId/:shardIndex', (req, res) => {
  try {
    const { fileId, shardIndex } = req.params
    const src = shardPath(fileId, shardIndex)

    if (!fs.existsSync(src)) {
      return res.status(404).json({ error: `Shard ${shardIndex} not found for file ${fileId}` })
    }

    const data = fs.readFileSync(src)
    const hash = sha256hex(data)

    res.set('Content-Type', 'application/octet-stream')
    res.set('x-shard-hash', hash)
    res.set('x-shard-index', shardIndex)
    res.set('x-shard-bytes', String(data.length))
    res.send(data)

    console.log(`[SERVE] fileId=${fileId} shard=${shardIndex} size=${data.length}B`)
  } catch (err) {
    console.error('[SERVE ERROR]', err.message)
    res.status(500).json({ error: err.message })
  }
})

/**
 * Delete a shard — called when file owner deletes the file
 * DELETE /shard/:fileId/:shardIndex
 */
app.delete('/shard/:fileId/:shardIndex', checkAuth, (req, res) => {
  try {
    const { fileId, shardIndex } = req.params
    const src = shardPath(fileId, shardIndex)
    if (fs.existsSync(src)) fs.unlinkSync(src)
    console.log(`[DELETE] fileId=${fileId} shard=${shardIndex}`)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * List all shards stored on this host
 * GET /shards
 */
app.get('/shards', checkAuth, (req, res) => {
  const files = fs.readdirSync(STORAGE).map(f => {
    const stat = fs.statSync(path.join(STORAGE, f))
    return { name: f, bytes: stat.size, modified: stat.mtime }
  })
  res.json({ count: files.length, shards: files })
})

// ── start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║   DecentraStore Host Daemon                  ║
║   Listening on port ${String(PORT).padEnd(25)}║
║   Storage: ${String(STORAGE).slice(0, 33).padEnd(33)}║
╚══════════════════════════════════════════════╝
`)
})
