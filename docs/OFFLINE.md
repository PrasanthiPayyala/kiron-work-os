# Kiron — Desktop / Offline mode

Kiron runs in three modes from the same codebase:

| Mode | How | Works offline? |
|---|---|---|
| Browser web app | `npm run dev` / hosted Vite build | Read cache only |
| Installed PWA (desktop / mobile) | Click the **Install** button in the topbar | UI shell + last-loaded data |
| Installed PWA + PowerSync | Same, with `VITE_POWERSYNC_URL` set | Full offline reads + queued writes for Tasks, Attendance, Approvals, Notifications |

## 1. PWA (works today, no extra service)

The PWA is wired via [vite-plugin-pwa](https://vite-plugin-pwa.netlify.app/). What you get out of the box:

- **Installable** on Chrome / Edge / Brave (Win/Mac/Linux/Android) and on iOS via Safari → Share → Add to Home Screen.
- **Service worker** caches the app shell + Supabase REST responses (24h TTL) + Storage objects (7d TTL).
- **Update banner** appears in the topbar when a new version is deployed.
- **Online/Offline pill** in the topbar reflects `navigator.onLine`.
- **Chat & Mail** sidebar entries dim with an offline icon when the network drops — they need a live connection (websocket / IMAP edge function) and won't work offline regardless of PowerSync.

Build for production:

```bash
npm run build
npm run preview     # to serve the built PWA locally on http://localhost:4173
```

Host the contents of `dist/` on any static host (Cloudflare Pages, Vercel, Netlify, S3+CloudFront, nginx). The first visit caches the shell; subsequent loads work offline until the cache TTL.

## 2. PowerSync (true offline reads + write queue)

PowerSync streams a subset of Postgres into a local SQLite-WASM database in the browser and replays mutations against Supabase when the device reconnects.

### What's already in the codebase

- `src/lib/powersync/schema.ts` — local schema for tasks, task_activity, attendance_logs, approvals, notifications, plus the lookup tables (profiles, companies, departments, projects, project_members).
- `src/lib/powersync/connector.ts` — `SupabaseConnector` that hands Supabase JWTs to PowerSync and replays queued writes via `supabase.from(table).upsert/update/delete`.
- `src/lib/powersync/provider.tsx` — `<PowerSyncProvider>` wrapper that initializes the local DB once a Supabase session exists. **No-op if `VITE_POWERSYNC_URL` is unset**, so the app keeps running unchanged until you opt in.
- `src/components/SyncIndicator.tsx` — topbar pill that surfaces pending write count while syncing or offline.

### What you need to do to activate it

1. **Create a PowerSync project.** Sign up at https://www.powersync.com → create an instance pointed at your Supabase project. Free tier covers small teams; check pricing for production.
2. **Define sync rules** in the PowerSync dashboard. A starting point that mirrors the schema in `src/lib/powersync/schema.ts`:

   ```yaml
   bucket_definitions:
     user_data:
       parameters: SELECT request.user_id() as user_id
       data:
         # tables this user can see — relies on Supabase RLS being correct
         - SELECT * FROM tasks
             WHERE assignee_id = bucket.user_id
                OR reviewer_id = bucket.user_id
                OR reporting_manager_id = bucket.user_id
                OR created_by = bucket.user_id
         - SELECT * FROM task_activity WHERE task_id IN (SELECT id FROM tasks)
         - SELECT * FROM attendance_logs WHERE user_id = bucket.user_id
         - SELECT * FROM approvals
             WHERE approver_id = bucket.user_id OR requested_by = bucket.user_id
         - SELECT * FROM notifications WHERE user_id = bucket.user_id

     global:
       data:
         - SELECT * FROM companies
         - SELECT * FROM departments
         - SELECT * FROM profiles
         - SELECT * FROM projects
         - SELECT * FROM project_members
   ```

   Tune these per your role model — `super_admin` / `founder` likely need broader buckets.

3. **Add the env var** to `.env.local`:

   ```
   VITE_POWERSYNC_URL=https://<your-instance>.journeyapps.com
   ```

4. **(Optional) Swap data reads to PowerSync** in the in-scope pages so they hit the local SQLite mirror instead of `useDataStore()`. The easiest pattern is `useQuery` from `@powersync/react`:

   ```tsx
   import { useQuery } from "@powersync/react";

   const { data: tasks = [] } = useQuery<TaskRow>(`
     SELECT * FROM tasks WHERE assignee_id = ? ORDER BY due_at NULLS LAST
   `, [user.id]);
   ```

   The current `dataStore.tsx` keeps working unchanged — it just stays online-only until you migrate page-by-page.

### What stays online-only (by design)

- **Chat** — uses Supabase Realtime channels; can't sync messages offline (the in-scope decision excluded it).
- **Mail** — IMAP/SMTP runs as Supabase Edge Functions; offline cache would diverge from the real mailbox.
- **First-time login** — Supabase Auth requires one network call. Cached sessions persist for the refresh-token lifetime (~1 hour access token, ~30 days refresh).

### Conflict policy

PowerSync replays writes in CRUD order using `upsert`. The current policy is **last-write-wins** — if two users edit the same task offline, the one that reconnects later overwrites the other. Acceptable for an internal ops tool with low write contention. For higher-stakes records (approvals, financial), validate in a Supabase trigger that checks `updated_at` before accepting the write.

## 3. Future: native desktop wrapper

If you later want signed Mac/Windows installers (vs PWA install), wrap the same Vite build with [Tauri](https://tauri.app/):

```bash
npm install --save-dev @tauri-apps/cli
npx tauri init     # generates src-tauri/
npx tauri build    # produces .msi/.dmg/.AppImage
```

Tauri reuses the existing `dist/` output and the system WebView — no code changes needed in `src/`. ~10 MB installer per OS.
