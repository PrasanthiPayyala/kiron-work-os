# Kiron Work OS — Production deployment (single Linux VM)

This runbook takes the app live on one Ubuntu/Debian VM you control via SSH +
sudo. Topology: **nginx** serves the PWA and reverse-proxies `/api` to the
**FastAPI** backend (uvicorn under systemd), backed by **Postgres** on the same
host. HTTPS via Let's Encrypt — required for PWA install + offline service
worker.

```
Browser ──HTTPS──> nginx ──/──────────> /var/www/kiron   (static PWA)
                         └──/api/──────> 127.0.0.1:8787   (FastAPI/uvicorn)
                                              │
                                              └────────> Postgres :5432 (localhost)
```

Replace `kiron.example.com` everywhere with your real domain. Point its DNS
**A record** at the VM's public IP before requesting a cert.

---

## 0. One-time: install system packages

```bash
sudo apt update
sudo apt install -y nginx postgresql python3-venv python3-pip git curl rsync
# Node 18+ for the frontend build:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
# TLS:
sudo apt install -y certbot python3-certbot-nginx
```

Create a service user and clone the repo:

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin kiron || true
sudo mkdir -p /opt/kiron && sudo chown kiron:kiron /opt/kiron
sudo -u kiron git clone <YOUR_REPO_URL> /opt/kiron
cd /opt/kiron
```

---

## 1. Database

```bash
sudo bash deploy/setup-db.sh 'a-strong-db-password'
```

Creates the `kiron` role + `kiron` database. Note the password — it goes in the
backend env next.

---

## 2. Backend env + provisioning

```bash
sudo mkdir -p /etc/kiron
sudo cp deploy/backend.env.example /etc/kiron/backend.env
sudo nano /etc/kiron/backend.env      # set DB password, JWT_SECRET, domain
#   JWT_SECRET — generate one:  openssl rand -hex 32
sudo chown root:kiron /etc/kiron/backend.env && sudo chmod 640 /etc/kiron/backend.env

# venv + deps + create db + migrations + seed
sudo -u kiron bash deploy/setup-backend.sh
```

`setup-backend.sh` runs `app.create_db` → `alembic upgrade head` →
`app.seed` (idempotent; seeds the 6 demo accounts, password `Kiron@2025`).

---

## 3. Run the backend under systemd

```bash
sudo cp deploy/kiron-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kiron-api
systemctl status kiron-api --no-pager
curl -s http://127.0.0.1:8787/health     # → {"status":"ok"}
```

---

## 4. Frontend build + publish

```bash
sudo -u kiron WEB_ROOT=/var/www/kiron bash deploy/deploy-frontend.sh
```

Builds with `.env.production` (`VITE_API_URL=/api`) and rsyncs `dist/` to
`/var/www/kiron`.

---

## 5. nginx + HTTPS

```bash
sudo cp deploy/nginx-kiron.conf /etc/nginx/sites-available/kiron
sudo sed -i 's/kiron.example.com/YOUR_DOMAIN/g' /etc/nginx/sites-available/kiron
sudo ln -sf /etc/nginx/sites-available/kiron /etc/nginx/sites-enabled/kiron
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# Issue the cert (also rewrites the vhost for 443 + HTTP→HTTPS redirect):
sudo certbot --nginx -d YOUR_DOMAIN
```

Open `https://YOUR_DOMAIN` → you should land on the login page. Sign in with a
seeded account (`prasanthi@kirongroup.in` / `Kiron@2025`). The browser's
install icon should appear (PWA), and DevTools → Application → Service Workers
should show an active worker.

---

## Updating after code changes

```bash
cd /opt/kiron && sudo -u kiron git pull

# backend changed (deps/migrations):
sudo -u kiron bash deploy/setup-backend.sh && sudo systemctl restart kiron-api

# frontend changed:
sudo -u kiron WEB_ROOT=/var/www/kiron bash deploy/deploy-frontend.sh
```

The PWA update banner appears for users automatically once the new `sw.js`
ships (nginx serves it `no-cache`).

---

## Verifying offline mode in production

1. Load the site over HTTPS, sign in (caches data into IndexedDB).
2. DevTools → Network → **Offline**, then reload — pages still render.
3. Change a task status / check in — succeeds optimistically; topbar shows a
   "queued" pill.
4. Network → **Online** — the queue drains and data refreshes from the API.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| `502 Bad Gateway` on `/api` | `systemctl status kiron-api`; is it bound to 127.0.0.1:8787? |
| Login 401 with correct creds | Did seed run? `sudo -u kiron /opt/kiron/backend/.venv/bin/python -m app.seed` |
| `/api` returns the HTML shell | nginx `location /api/` block missing trailing slash on `proxy_pass` |
| No install button / SW inactive | Site must be HTTPS with a valid cert (not self-signed) |
| DB auth fails | `DATABASE_URL` password must match what `setup-db.sh` set |
| Logged out on refresh | JWT in localStorage; confirm `JWT_SECRET` is stable (not regenerated per deploy) |

## Backups

```bash
# nightly dump (add to cron):
sudo -u postgres pg_dump kiron | gzip > /var/backups/kiron-$(date +%F).sql.gz
```
