# Kiron Work OS

Internal operations platform for the Kiron Group — replaces personal WhatsApp,
ad-hoc file transfers, and email threads for ~20 people across the group's
companies. Tasks, projects, attendance, leave, chat with attachments,
approvals, and a notifications feed, behind one sign-in.

Single-tenant, self-hosted on one Linux VM. PWA so it installs to phone /
desktop and keeps working offline.

## Stack

| Layer | Choice |
|---|---|
| Frontend | React 18 · Vite 5 · TypeScript 5 · Tailwind · shadcn/ui · React Router v6 |
| State | React Query + a custom `DataStoreProvider` over a single `/bootstrap` snapshot |
| Offline | vite-plugin-pwa + Dexie/IndexedDB write-through cache + mutation queue |
| Realtime | WebSocket hub on the backend with per-user fan-out |
| Backend | FastAPI · SQLAlchemy 2 · psycopg 3 · Alembic |
| Auth | JWT (PyJWT) · argon2 password hashing |
| Storage | Local filesystem (`/var/lib/kiron/files`) via a `/files` endpoint |
| DB | PostgreSQL 14+ |
| Email | stdlib `smtplib` (SSL/STARTTLS auto-detect) — used for password reset |

## Repo layout

```
backend/                 FastAPI app + SQLAlchemy schema + Alembic migrations
  app/main.py            FastAPI entry (lifespan starts the SLA scheduler)
  app/routers/           One module per resource (tasks, projects, chat, …)
  app/scheduler.py       APScheduler — SLA breach + due-today notifications
  alembic/versions/      Schema migrations (0001 baseline → 0007 holidays)
  sql/schema.sql         Authoritative schema (kept in sync with migrations)
src/                     Frontend
  lib/auth.tsx           AuthProvider, role-based nav, `can` capability map
  lib/dataStore.tsx      Single hydration cache + WS subscription
  lib/api.ts             Thin REST client with offline-queue wrapper
  lib/offline/           Dexie schema + mutation queue
  lib/mappers.ts         DB row → domain type
  pages/                 One per route
  components/            Reusable UI (incl. shadcn primitives under ui/)
deploy/                  Production deployment kit (see DEPLOY.md)
CLAUDE.md                Project-specific instructions for the Claude Code CLI
```

## Local development

Prereqs: Python 3.11+, Node 20+, PostgreSQL 14+ running locally.

```bash
# Backend
cd backend
python -m venv .venv
.venv/bin/pip install -r requirements.txt    # Windows: .venv\Scripts\pip
cp .env.example .env                          # set DATABASE_URL + JWT_SECRET
.venv/bin/python -m app.create_db             # CREATE DATABASE kiron + roles
.venv/bin/python -m alembic upgrade head      # apply migrations
.venv/bin/python -m app.seed                  # seed demo accounts + sample data
.venv/bin/python -m uvicorn app.main:app --port 8787 --reload

# Frontend (new terminal, repo root)
npm install
npm run dev        # http://localhost:8080
```

Open <http://localhost:8080> and sign in.

### Seeded accounts

All passwords are `Kiron@2025`. The `must_change_password` flag is **off** on
seeded rows so you land straight on the dashboard.

| Email | Role |
|---|---|
| `kiran@kirongroup.in` | super_admin |
| `prasanthi@kirongroup.in` | founder |
| `anita@kirongroup.in` | hr_admin |
| `samiyuddin.mohammed@kirongroup.in` | manager |
| `varsha.cheriyala@kirongroup.in` | employee |
| `pallavi.gonepalli@kirongroup.in` | intern |

Accounts created from **People → Add user** (HR/super_admin) get
`must_change_password=true` — the new joiner is forced through
`/change-password` on first sign-in.

## Roles & navigation

Eight roles drive the sidebar via `roleNavAccess` in `src/lib/auth.tsx`:

`super_admin`, `founder`, `founder_office_coordinator`,
`founder_office_support`, `manager`, `hr_admin`, `employee`, `intern`

Capability checks (e.g. who can create projects, deactivate users, edit
holidays) live in `src/lib/auth.tsx`'s `can` object on the frontend and
`backend/app/authz.py` on the backend — keep the two in sync.

## What's shipped

- Dashboard, My Work, Projects (CRUD + members), Tasks, Attendance, Leave,
  Approvals, Reports, People (CRUD + deactivate), Notifications, Chat
  (realtime + attachments)
- Password reset via email link
- Forced password change on first login
- Working-hours config: company default + per-employee override
- Holiday calendar: gazetted / optional / informational types, bulk import
- User lifecycle: deactivate to block login + invalidate live sessions,
  intern → full-time conversion preserves project memberships
- SLA breach scheduler (APScheduler in-process, advisory-locked for
  multi-worker safety)
- Offline shell + write-through cache + mutation queue

## Production deployment

Two runbooks depending on the host:

- [`deploy/DEPLOY.md`](deploy/DEPLOY.md) — plain Ubuntu VM with nginx +
  systemd + Let's Encrypt. The simplest path if you control the box.
- [`deploy/CPANEL.md`](deploy/CPANEL.md) — VPS running cPanel/WHM on
  AlmaLinux / CloudLinux / CentOS, hosted at a subdomain. Uses cPanel's
  Apache as the front (AutoSSL handles the cert) and proxies to FastAPI.

The `deploy/` directory ships ready-to-use config: `kiron-api.service`,
`nginx-kiron.conf`, `backend.env.example`, `setup-db.sh`,
`setup-backend.sh`, `deploy-frontend.sh`.

After any pull on the VM:

```bash
cd /opt/kiron && sudo -u kiron git pull
sudo -u kiron bash deploy/setup-backend.sh && sudo systemctl restart kiron-api
sudo -u kiron WEB_ROOT=/var/www/kiron bash deploy/deploy-frontend.sh
```

## Testing

```bash
# Backend
cd backend && .venv/bin/python -m pytest

# Frontend type + unit
npm run typecheck
npm run test
```

## Known gaps

- The `mail` module is hidden in v1 (still Supabase-bound). The route and
  components stay on disk so it can be re-enabled when the IMAP rebuild lands.
- No audit log yet — admin actions (deactivations, role changes, project
  deletes) aren't recorded. On the post-rollout backlog.
- No idle-vs-active hour tracking. Open design question; see
  `~/.claude/projects/.../memory/project_tuesday_golive_planning.md`.

## License

Private — Kiron Group internal use only.
