# Kiron Work OS — cPanel/WHM deployment

For a VPS running WHM/cPanel on AlmaLinux / CloudLinux / CentOS, hosting at a
subdomain (these instructions use `work.innomaxsol.com`). The companion
`DEPLOY.md` is for a plain Ubuntu VM and assumes you control nginx; this one
keeps **cPanel's Apache as the front** so AutoSSL keeps managing the cert and
nothing fights with cPanel.

```
Browser ──HTTPS──> cPanel Apache (your VPS public IP)
                        │ ServerName work.innomaxsol.com
                        ├── /  (static React PWA from the subdomain docroot)
                        ├── /api/  ──ProxyPass──> 127.0.0.1:8787  (FastAPI)
                        └── /ws    ──ProxyPass──> ws://127.0.0.1:8787/ws
                                                        │
                                                        └─> Postgres :5432 (localhost)
```

Replace `work.innomaxsol.com`, `innomax` (cPanel account), and the email
addresses with your own values throughout.

---

## 0. One-time prerequisites

In WHM/cPanel UI (do this first, before any SSH work):

1. **Create the subdomain.**
   Log in to cPanel as the account that owns `innomaxsol.com` →
   **Domains → Create A New Domain** → `work.innomaxsol.com`. cPanel creates
   the document root (typically `/home/innomax/work.innomaxsol.com/`) and an
   Apache vhost.

2. **Issue / verify SSL.**
   cPanel → **SSL/TLS Status** → ensure `work.innomaxsol.com` shows AutoSSL
   active. If not, click **Run AutoSSL**. Wait for the cert to be issued
   before doing anything else (Apache reloads automatically).

3. **Create the noreply mailbox.**
   cPanel → **Email Accounts → Create** → `noreply@innomaxsol.com`, set a
   strong password, note it down. We'll point the backend's SMTP config at
   `mail.innomaxsol.com:465` with these credentials.

Now SSH in as root.

---

## 1. System packages

AlmaLinux/CentOS 9 ships Python 3.9 by default; we need 3.11+. Install the
Python 3.11 module, plus Postgres, Node, git, rsync:

```bash
sudo dnf install -y dnf-plugins-core epel-release
sudo dnf module reset python -y || true
sudo dnf module install -y python:3.11 || sudo dnf install -y python3.11
sudo dnf install -y postgresql-server postgresql-contrib git rsync
# Node 20 via NodeSource (RHEL family):
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs
```

Verify:
```bash
python3.11 --version    # 3.11.x
node --version          # v20.x
postgres --version      # 14+ ideally
```

---

## 2. Postgres

Initialise the cluster (CentOS/AlmaLinux requires this; Ubuntu auto-inits):

```bash
sudo /usr/bin/postgresql-setup --initdb
sudo systemctl enable --now postgresql
```

Switch to local md5 auth so we can use a password (default is `ident`):

```bash
PG_HBA=$(sudo -u postgres psql -tAc "SHOW hba_file;")
sudo sed -i 's|^\(host\s\+all\s\+all\s\+127.0.0.1/32\s\+\)ident|\1md5|' "$PG_HBA"
sudo sed -i 's|^\(host\s\+all\s\+all\s\+::1/128\s\+\)ident|\1md5|' "$PG_HBA"
sudo systemctl restart postgresql
```

Create the role + database:

```bash
DB_PASSWORD='choose-a-strong-password-here'
sudo -u postgres psql <<SQL
CREATE ROLE kiron WITH LOGIN PASSWORD '$DB_PASSWORD' CREATEDB;
CREATE DATABASE kiron OWNER kiron;
SQL
```

Confirm:
```bash
PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U kiron -d kiron -c 'SELECT 1'
```

---

## 3. Clone the repo + create service user

We keep the app **outside** any cPanel user's home so cPanel can't touch it.

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin kiron || true
sudo mkdir -p /opt/kiron && sudo chown kiron:kiron /opt/kiron
sudo -u kiron git clone https://github.com/PrasanthiPayyala/kiron-work-os.git /opt/kiron
cd /opt/kiron
```

---

## 4. Backend config + provisioning

```bash
sudo mkdir -p /etc/kiron
sudo cp deploy/backend.env.example /etc/kiron/backend.env
sudo nano /etc/kiron/backend.env
```

Fill in:

```
DATABASE_URL=postgresql+psycopg://kiron:THE_DB_PASSWORD_FROM_STEP_2@localhost:5432/kiron
JWT_SECRET=                # generate:  openssl rand -hex 32
JWT_ACCESS_TTL_MIN=30
JWT_REFRESH_TTL_DAYS=14

CORS_ORIGINS=https://work.innomaxsol.com
APP_BASE_URL=https://work.innomaxsol.com

FILES_DIR=/var/lib/kiron/files

SMTP_HOST=mail.innomaxsol.com
SMTP_PORT=465
SMTP_SSL=true
SMTP_USERNAME=noreply@innomaxsol.com
SMTP_PASSWORD=THE_MAILBOX_PASSWORD_FROM_STEP_0
SMTP_FROM=Kiron Work OS <noreply@innomaxsol.com>

PASSWORD_RESET_TTL_MIN=60
SLA_CHECK_ENABLED=true
SLA_CHECK_INTERVAL_MIN=15
SLA_WARN_WINDOW_HOURS=4
```

Lock it down:
```bash
sudo chown root:kiron /etc/kiron/backend.env
sudo chmod 640 /etc/kiron/backend.env
sudo mkdir -p /var/lib/kiron/files
sudo chown -R kiron:kiron /var/lib/kiron
```

Provision: the helper script wants `python3.11` available as `python3.11`,
which we have. It creates the venv, installs deps, runs migrations, seeds.

```bash
# DEPLOY.md's setup-backend.sh assumes `python3 -m venv`; on AlmaLinux that
# would pick 3.9. Override explicitly for the venv create step:
sudo -u kiron python3.11 -m venv /opt/kiron/backend/.venv
sudo -u kiron /opt/kiron/backend/.venv/bin/pip install --upgrade pip
sudo -u kiron /opt/kiron/backend/.venv/bin/pip install -r /opt/kiron/backend/requirements.txt

# Migrations + seed:
cd /opt/kiron/backend
sudo -u kiron .venv/bin/python -m alembic upgrade head
sudo -u kiron .venv/bin/python -m app.seed
```

Check:
```bash
sudo -u kiron .venv/bin/python -c "from app.config import settings; print(settings.app_base_url, settings.smtp_host)"
```

---

## 5. Run the backend under systemd

```bash
sudo cp /opt/kiron/deploy/kiron-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kiron-api
systemctl status kiron-api --no-pager
curl -s http://127.0.0.1:8787/health     # → {"status":"ok"}
```

If status is failed: `journalctl -u kiron-api -n 50 --no-pager` for the
trace. Most common: missing Python deps, wrong DB password, SELinux
blocking writes to `/var/lib/kiron/files`.

If SELinux complains, allow writes:
```bash
sudo setsebool -P httpd_can_network_connect 1   # lets Apache proxy to 8787
sudo chcon -Rt httpd_sys_rw_content_t /var/lib/kiron/files
```

---

## 6. Build + publish the frontend to the subdomain docroot

The docroot is the path you saw in cPanel when you created the subdomain.
Typically `/home/innomax/work.innomaxsol.com/`. Set it explicitly:

```bash
SUBDOMAIN_DOCROOT=/home/innomax/work.innomaxsol.com
sudo test -d "$SUBDOMAIN_DOCROOT" || echo "docroot not found — check the path in cPanel"
```

Build on the VM:
```bash
cd /opt/kiron
sudo -u kiron bash -c 'cat > .env.production <<EOF
VITE_API_URL=/api
EOF'
sudo -u kiron npm ci
sudo -u kiron npm run build       # output: /opt/kiron/dist/
```

Publish to the docroot, preserving cPanel's `.htaccess` if it left one
behind:

```bash
sudo rsync -a --delete --exclude='.htaccess' /opt/kiron/dist/ "$SUBDOMAIN_DOCROOT/"
# The cPanel user needs to own its docroot:
sudo chown -R innomax:innomax "$SUBDOMAIN_DOCROOT"
```

Quick check — load `https://work.innomaxsol.com` in a browser. You should
see the React app load BUT the login form will fail (no `/api` proxy yet).
That's the next step.

---

## 7. Apache reverse-proxy via WHM Include Editor

cPanel regenerates Apache vhosts on rebuild, so editing the vhost directly
is fragile. The right place is the **Include Editor**, which survives
rebuilds.

In WHM:

1. **Service Configuration → Apache Configuration → Include Editor**
2. **Post VirtualHost Include → 2_4 (or 'All Versions')** → paste the
   block below, replacing the docroot if yours differs:

```apache
<VirtualHost *:443>
    ServerName work.innomaxsol.com
    DocumentRoot /home/innomax/work.innomaxsol.com

    # Required modules: mod_proxy, mod_proxy_http, mod_proxy_wstunnel,
    # mod_rewrite, mod_headers. All are standard on WHM EasyApache.

    # API endpoints — strip the /api prefix so FastAPI's routes match.
    ProxyPreserveHost On
    ProxyRequests Off
    ProxyPass        /api/  http://127.0.0.1:8787/
    ProxyPassReverse /api/  http://127.0.0.1:8787/

    # WebSocket for chat / notifications / approvals realtime.
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule ^/ws$ ws://127.0.0.1:8787/ws [P,L]

    # SPA fallback — any unknown path serves index.html so React Router
    # owns the URL bar.
    <Directory /home/innomax/work.innomaxsol.com>
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
        RewriteEngine On
        RewriteCond %{REQUEST_URI} !^/api/
        RewriteCond %{REQUEST_URI} !^/ws$
        RewriteCond %{REQUEST_FILENAME} !-f
        RewriteCond %{REQUEST_FILENAME} !-d
        RewriteRule . /index.html [L]
    </Directory>

    # Make sw.js never cache (PWA service worker updates rely on this).
    <Files "sw.js">
        Header set Cache-Control "no-cache, no-store, must-revalidate"
    </Files>

    # Hashed assets — long cache.
    <FilesMatch "\.(js|css|woff2|png|jpg|svg)$">
        Header set Cache-Control "public, max-age=31536000, immutable"
    </FilesMatch>
</VirtualHost>
```

3. Click **Update** → WHM runs `apachectl configtest` and reloads. If it
   errors, copy the message back to me.

Verify proxy works:
```bash
curl -s https://work.innomaxsol.com/api/health     # → {"status":"ok"}
```

If you get `503 Service Unavailable` from Apache: SELinux is blocking the
proxy. Run `sudo setsebool -P httpd_can_network_connect 1` and retry.

---

## 8. Smoke test before sharing with the team

1. Visit `https://work.innomaxsol.com` → login screen renders.
2. Sign in as `kiran@kirongroup.in` / `Kiron@2025` → dashboard loads.
3. **Settings → Working hours** → confirm or edit Kiron Group's schedule.
4. **Settings → Holidays → Bulk import** → paste the 2026 list (the format
   helper shows an example). Should report `inserted=13`.
5. **Attendance** → Diwali / Christmas / Republic Day should appear on the
   30-day grid (where they fall within the window) and in "Upcoming
   holidays".
6. **People → Add user** → create a throwaway account. Sign out, sign in
   as them — forced password change kicks in.
7. From the login page → **Forgot password** → enter your real email →
   check inbox. If nothing arrives, see Troubleshooting.
8. **DevTools → Application → Service Workers** → should show an active
   worker. Toggle Network → Offline, reload the page — UI still renders.

---

## 9. Updating after code changes

```bash
cd /opt/kiron && sudo -u kiron git pull

# Backend changed (deps / migrations):
sudo -u kiron /opt/kiron/backend/.venv/bin/pip install -r /opt/kiron/backend/requirements.txt
sudo -u kiron /opt/kiron/backend/.venv/bin/python -m alembic upgrade head
sudo systemctl restart kiron-api

# Frontend changed:
sudo -u kiron npm ci && sudo -u kiron npm run build
sudo rsync -a --delete --exclude='.htaccess' /opt/kiron/dist/ /home/innomax/work.innomaxsol.com/
sudo chown -R innomax:innomax /home/innomax/work.innomaxsol.com
```

The PWA update banner appears in users' browsers automatically once the
new `sw.js` ships.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| `502 Bad Gateway` from `/api` | `systemctl status kiron-api`; is uvicorn on 127.0.0.1:8787? |
| `503 Service Unavailable` from Apache | SELinux: `sudo setsebool -P httpd_can_network_connect 1` |
| Login 401 with seeded password | Did `app.seed` run? `sudo -u kiron /opt/kiron/backend/.venv/bin/python -m app.seed` |
| WebSocket connect closes immediately | `mod_proxy_wstunnel` not loaded; WHM → EasyApache 4 → enable it, rebuild |
| Subdomain serves cPanel's default index | docroot not pointed at our `dist/`; re-run rsync, verify file ownership |
| Password reset email never arrives | `journalctl -u kiron-api | grep -i smtp`; firewall blocking outbound 465? |
| `nano: command not found` | `sudo dnf install -y nano vim` (CentOS minimal ships neither) |
| cPanel's `.htaccess` reappears and serves a 403 | Our SPA rewrite needs `AllowOverride All` on the docroot; the Include Editor block above sets it |
| Logged out on refresh | `JWT_SECRET` changed between deploys — keep it stable |

## Backups

```bash
# Nightly db dump — add to root's crontab:
0 2 * * *  PGPASSWORD='<db-password>' pg_dump -h 127.0.0.1 -U kiron kiron \
           | gzip > /var/backups/kiron-$(date +\%F).sql.gz
```

Also back up `/var/lib/kiron/files` (the attachments directory) the same way
— a postgres dump alone won't restore files.
