# Kiron Presence Client

Small (~5-8 MB) tray-only desktop app that posts activity heartbeats
and auto check-in / check-out to Kiron Work OS. Built on Tauri 2 (Rust
core + system webview). Runs on Windows + macOS.

**Session 3 scope (this commit):** project scaffold + sign-in webview.
No activity tracking, no tray icon, no auto check-in yet — those land
in Session 4. This deliberately ships as an app that can only sign in.

## Requirements

Development machine needs:

- **Rust** — 1.77 or newer. `rustup default stable`.
- **Node.js** — 18 or newer (only to run the `@tauri-apps/cli` binary).
- **Platform build deps**:
  - Windows: Microsoft Edge WebView2 runtime (pre-installed on Win 11);
    Visual Studio 2022 Build Tools with the "Desktop development with C++"
    workload.
  - macOS: Xcode Command Line Tools (`xcode-select --install`).
  - Linux (dev only, we don't ship Linux): `libwebkit2gtk-4.1-dev`
    + `libssl-dev` + `libayatana-appindicator3-dev`.

## First-run setup

```
cd desktop-client
npm install                 # pulls @tauri-apps/cli only
```

Icons: this scaffold ships without real PNG/ICO/ICNS files. See
`src-tauri/icons/README.md` — either drop a placeholder 512x512 PNG in
and run `npx @tauri-apps/cli icon icon.png`, or comment out the `icon`
array in `tauri.conf.json` for local dev.

## Run in dev mode

```
npm run dev
```

Opens the sign-in window. Enter any Kiron Work OS credentials — the
app calls `POST https://crm.innomaxsol.com/api/auth/login`. On success
the returned access + refresh tokens land in the OS keychain (Windows
Credential Manager on Windows, macOS Keychain on Mac). Sign out clears
them.

**Pointing at a local backend:** by default the app hits production.
To point at localhost during dev, once you're signed in (or immediately
after uninstall) edit the store file — location varies by OS:

- Windows: `%APPDATA%\in.innomaxsol.kiron.presence\config.json`
- macOS: `~/Library/Application Support/in.innomaxsol.kiron.presence/config.json`

Set `api_base` to `"http://localhost:8787"`. The next launch will pick
it up. (A signed-out settings panel to do this from the UI lands in
Session 5.)

## Build release installer

```
npm run build
```

Produces:

- Windows: `src-tauri/target/release/bundle/msi/*.msi`
- macOS: `src-tauri/target/release/bundle/dmg/*.dmg`

**Signing** — the build is unsigned until Session 5 introduces the
signing certificates. Unsigned MSIs work but SmartScreen warns; unsigned
DMGs get a Gatekeeper block that users must dismiss with
`right-click → Open`. Do not distribute unsigned builds to employees.

## Module layout

```
src-tauri/
  src/
    main.rs        # entry — delegates to lib::run()
    lib.rs         # tauri::Builder wiring, plugin registration
    config.rs      # non-secret app state (device_id, api_base) via tauri-plugin-store
    keychain.rs    # OS keychain wrapper — access + refresh tokens only
    api.rs         # HTTP client + typed request/response bindings
    commands.rs    # #[tauri::command]s the webview invokes
  Cargo.toml
  tauri.conf.json
  capabilities/
    default.json   # per-plan permissions
src/
  index.html       # sign-in form
  sign-in.js       # form handler → invoke("sign_in")
  style.css        # local styles, no framework
```

## What each session adds

- **Session 3:** scaffold + sign-in + keychain
- **Session 4:** activity poller (`GetLastInputInfo` / `CGEventSource`),
  idle interval detection, auto check-in on first activity, heartbeat
  loop every 5 min, tray icon with menu, auto-launch registration,
  best-effort check-out on quit
- **Session 5 (this):** auto-update wiring (`tauri-plugin-updater`),
  single-instance guard, per-state tray icons (green/amber/grey via
  15s poll), signed-build config, GitHub Actions release workflow,
  `latest.json` manifest template, Apache config for `/desktop/*`,
  detailed [`SIGNING.md`](SIGNING.md) runbook covering cert purchase +
  notarization
- **Session 6:** coordinated deploy — backend + PWA + this client all
  cut together

## Session 5 additions detail

**Auto-update:** [`src-tauri/src/updater.rs`](src-tauri/src/updater.rs)
polls `https://crm.innomaxsol.com/desktop/latest.json` on boot + every
4 hours. If a newer version is signed with the ed25519 key baked into
`tauri.conf.json`, the client downloads it, fires a best-effort
check-out, and restarts into the new build. Passive install on Windows
(silent, brief installer flash), in-place bundle swap on macOS.

**Single-instance guard:** [`tauri-plugin-single-instance`](https://v2.tauri.app/plugin/single-instance/)
prevents two agents racing for check-in / heartbeat. Second launch
raises the first instance's window and exits.

**Per-state tray icons:** [`tray.rs::spawn_status_updater`](src-tauri/src/tray.rs)
polls the tracker every 15s and swaps the tray icon between three
baked-in PNGs — green (active), amber (idle), grey (offline / signed
out). SVG source in [`src-tauri/icons/svg/`](src-tauri/icons/svg/);
release builds require the rasterized PNGs to exist (dev builds fall
back to the app icon).

**GitHub Actions release pipeline:** [`.github/workflows/desktop-client.yml`](../.github/workflows/desktop-client.yml)
triggers on `desktop-v*` tags. Builds MSI + DMG on their respective
runners, signs both if the signing secrets are configured, notarizes
the DMG via `xcrun notarytool`, attaches artifacts to the release.
Icon rasterization runs in-workflow via `rsvg-convert` so releases
never ship stale icons.

**Signing runbook:** see [`SIGNING.md`](SIGNING.md) end-to-end — from
"where do I buy the Windows OV cert" through the per-release checklist.
The one-time setup takes 2-3 hours + ~₹8-25k/yr (Windows OV) + $99/yr
(Apple Developer). All subsequent releases are `git tag && push`.

**Update-manifest hosting:** Apache snippet in
[`../deploy/apache-desktop.conf.snippet`](../deploy/apache-desktop.conf.snippet)
mounts `/home/crminnomaxsol/desktop-artifacts/` at
`https://crm.innomaxsol.com/desktop/*` with correct no-cache headers
for `latest.json` and long immutable-cache for the installer blobs.

## What's still deferred to Session 6

Actual signing certs, actual notarization credentials, actual
installer testing on real Windows + Mac hardware, and the coordinated
production deploy (backend migration 0037 + PWA + agent installation).
Everything code-side is ready — Session 6 is operational execution
(buy certs, notarize, distribute, monitor).

## Session 4 behavior detail

**State machine (activity-poll driven, no OS message hooks):**

- Every 30s: read OS "seconds since last input" via
  `GetLastInputInfo` (Windows) or `CGEventSource::secondsSinceLastEventType`
  (macOS).
- `Active` = last input < 30 min ago. `Idle` = >= 30 min.
- First `Active` tick of the process lifetime → auto check-in (POST
  `/attendance` with `source=desktop_agent`, `device_id`, `hostname`,
  `client_version`). If server already has today's row (e.g. PWA
  already checked in), reuse it.
- `Idle → Active` transition with a >45-min gap → treat as a fresh
  unlock, re-check whether we need to auto-post again (handles
  overnight sleep-and-boot).
- `Idle → Active` transition with a >30-min gap → POST
  `/attendance/idle-intervals` for the away window. Server dedups via
  `ON CONFLICT (user_id, started_at)`.
- Every 5 min while `Active`: POST `/attendance/heartbeat`.
- App exit (RunEvent::ExitRequested, "Quit" from tray menu): PATCH
  check-out. Backend auto-close scheduler is our safety net for
  crashes we can't hook.

**Tray icon:** static icon + menu with `Show status`, `Check out now`,
`Sign out`, `Quit`. Left-click reopens the status window. Session 5
adds per-state icons (green/yellow/gray).

**Auto-launch:** registered via `tauri-plugin-autostart` on first run
so employees don't have to remember to launch it every day.

**Token refresh:** any 401 on an authed call triggers one
`/auth/refresh` retry. If refresh itself fails, the tracker stops and
the sign-in webview surfaces "Your session expired" so the user
re-authenticates.

## Manual test checklist (post-cargo-check, before Session 5)

Once you have Rust + Node set up:

1. `cargo tauri dev` — sign-in window opens, form works.
2. Sign in with a real Kiron user — window drops into tray after ~1s.
3. Wait 30-60s + move the mouse — check backend for a new
   `attendance_logs` row with `source='desktop_agent'`.
4. Right-click tray → Show status — window reappears with "Checked in
   · Xh Ym active".
5. Leave the machine idle 35+ min → move mouse → check backend for a
   fresh `idle_intervals` row.
6. Every 5 min: `last_heartbeat_at` should tick forward on the row.
7. Right-click tray → Quit — row's `check_out_at` gets set to now.
8. Reopen app — sign-in flow is skipped, tracker resumes today's row.
