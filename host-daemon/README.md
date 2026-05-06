# DecentraStore Host Daemon

Run this on every machine that wants to rent out storage space.

## Quick Start

```bash
cd host-daemon
npm install
node index.js
# Daemon running on http://localhost:3001
```

## Deploy to Oracle Cloud Free Tier (always free)

1. Sign up at https://cloud.oracle.com (free tier — no credit card needed initially)
2. Create Instance → Ubuntu 22.04 → VM.Standard.E2.1.Micro (Always Free)
3. Note the public IP (e.g. `129.80.45.12`)
4. SSH in and run:

```bash
sudo apt update && sudo apt install -y nodejs npm git
git clone https://github.com/YOUR_USERNAME/decentrastore.git
cd decentrastore/host-daemon
npm install
# Run permanently with pm2:
npm install -g pm2
pm2 start index.js --name decentrastore-host
pm2 save && pm2 startup
```

5. Open port 3001 in Oracle's Security List (VCN → Security Lists → Ingress Rules → Add 0.0.0.0/0 TCP 3001)

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Listening port |
| `STORAGE_DIR` | `./shards` | Where shard files are saved |
| `API_SECRET` | *(none)* | Shared secret for upload auth (set this in production) |

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Status, shard count, MB used |
| `POST` | `/shard/:fileId/:shardIndex` | Upload a shard (binary body) |
| `GET` | `/shard/:fileId/:shardIndex` | Download a shard |
| `DELETE` | `/shard/:fileId/:shardIndex` | Delete a shard |
| `GET` | `/shards` | List all stored shards |

## Security Notes

- Set `API_SECRET` env var so only the DecentraStore frontend can upload/delete
- Each shard is SHA-256 verified on receipt — tampered uploads are rejected
- Shards are AES-256-GCM encrypted by the renter before upload — the host never sees plaintext
