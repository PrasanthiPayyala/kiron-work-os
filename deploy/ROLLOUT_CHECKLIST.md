# Kiron Work OS — go-live checklist

Run through this the morning of rollout, in order. Each item has a definitive
"this is done" signal — don't skip ahead until you see it.

## 1. The platform is healthy

```bash
# API
curl -s https://crm.innomaxsol.com/api/health
# Expect: {"status":"ok"}

# WebSocket (force HTTP/1.1)
curl --http1.1 -is --max-time 3 \
  -H "Upgrade: websocket" -H "Connection: upgrade" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Sec-WebSocket-Version: 13" \
  "https://crm.innomaxsol.com/ws?token=invalid" | head -3
# Expect: HTTP/1.1 403 Forbidden  (Server: Apache)  — proves WS reaches FastAPI

# Migration is current
sudo -u postgres psql -d kiron -tAc "SELECT version_num FROM alembic_version"
# Expect: 0008_saturday_pattern (or the latest at deploy time)

# Backups configured
sudo crontab -l | grep pg_dump
# Expect: a line like  0 2 * * *  PGPASSWORD=... pg_dump ...
ls -lt /var/backups/kiron-*.sql.gz 2>/dev/null | head -3
# Expect: at least one recent dump (last 24h)
```

## 2. Deactivate demo / seed accounts

The seed file shipped these — **none are real Kiron Group employees** except
Kiran and Prasanthi. Deactivate the rest before the team logs in so nobody
can sign in with the published `Kiron@2025` default.

Sign in as `kiran@kirongroup.in` → **People** → for each row below, open
**Edit** → set **Status = Exited** → save.

| Demo email | Action |
|---|---|
| `anita@kirongroup.in` | Deactivate (fictional HR — real HR is Karunya) |
| `samiyuddin.mohammed@kirongroup.in` | Deactivate (fictional manager) |
| `varsha.cheriyala@kirongroup.in` | Deactivate (fictional employee) |
| `pallavi.gonepalli@kirongroup.in` | Deactivate (fictional intern) |
| `prasanthi@kirongroup.in` | **Keep active** — real founder. She must change her password on first sign-in. |
| `kiran@kirongroup.in` | **Keep active** — that's you. |

Verify nobody can sign in with the default password:

```bash
# Replace TARGET with each demo email in turn. Expect 401.
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST https://crm.innomaxsol.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"anita@kirongroup.in","password":"Kiron@2025"}'
```

## 3. Working-hours and holidays match Kiron Group's calendar

Sign in as `kiran@kirongroup.in`:

- **Settings → Working hours** → for every company in the list:
  - Working days include Mon–Sat (Sun off)
  - **Working Saturdays** shows **1st, 3rd, 5th** highlighted, **2nd and 4th**
    unchecked
- **Settings → Holidays** → the 2026 list is present (Diwali, Christmas,
  Republic Day, Independence Day, etc.). If it isn't, **Bulk import** the
  list now.

Smoke check: **Attendance** for any user → the 30-day grid should shade the
2nd / 4th Saturdays and all Sundays as "weekly off", and any gazetted
holiday in the window as "holiday".

## 4. Real users are seeded

Quick query — list everyone who currently can sign in:

```bash
sudo -u postgres psql -d kiron -c \
  "SELECT p.full_name, p.email, p.is_active, array_agg(ur.role) AS roles
   FROM profiles p LEFT JOIN user_roles ur ON ur.user_id=p.id
   WHERE p.is_active = true
   GROUP BY p.id, p.full_name, p.email, p.is_active
   ORDER BY p.full_name"
```

Eyeball the list. Everyone should be a real Kiron Group person. If anyone is
missing → **People → Add user**. If Karunya doesn't show `hr_admin`, open her
profile and fix the role.

## 5. Hand out real passwords

For every newly-onboarded user, you (or HR / Karunya) should have set a
temporary password during **People → Add user**. The system forces a change
on first sign-in (`must_change_password` flag), so the temp value only needs
to be deliverable — not secret.

- WhatsApp / SMS the temp password individually. **Never** post one default
  password in a group chat — that's the "Kiron@2025" mistake we just
  cleaned up.
- Include the URL: `https://crm.innomaxsol.com`
- Mention they'll be asked to set a new password on first sign-in.

## 6. Final smoke test from a phone

Pull out your phone, leave wifi, do this on cellular:

1. Open `https://crm.innomaxsol.com` in Chrome / Safari
2. Sign in as yourself
3. Dashboard renders within 3 seconds
4. **Add to Home Screen** (Android) / **Share → Add to Home Screen** (iOS) →
   the PWA installs
5. Open the installed icon → no login required (session sticks)
6. Open **Chat** → send a message in any group → it appears immediately
7. Open **Attendance → Check in** → succeeds
8. Pull down to refresh → no errors

If any step fails, **do not announce yet**. Capture the error and we'll fix
before sending the broadcast.

## 7. Announce

Once steps 1–6 are clean, send the team:

> Kiron Work OS is live at https://crm.innomaxsol.com.
> Your temporary password is in a personal message from <Karunya / HR>.
> You'll be asked to set your own on first sign-in.
> Install it on your phone via "Add to home screen" for offline access.
> Questions: ping #kiron-rollout or reply to this message.

## After go-live (day 1 things to watch)

- `journalctl -u kiron-api -f` for runtime errors as people start logging in
- `tail -f /etc/apache2/logs/domlogs/crm.innomaxsol.com` for 5xx
- Anybody reporting "I can see another user's data" → STOP, page Kiran, this
  is a permissions bug
- The `/ws` 101 status in browser DevTools — confirm at least one person is
  staying connected for realtime
