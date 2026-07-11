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

- **Session 3 (this):** scaffold + sign-in + keychain
- **Session 4:** activity poller (`GetLastInputInfo` / `CGEventSource`),
  idle interval detection, session unlock / shutdown hooks,
  auto check-in / heartbeat / check-out, tray icon
- **Session 5:** code signing, auto-update manifest, real icons,
  installer testing on hardware
- **Session 6:** coordinated deploy — backend + PWA + this client all
  cut together
