# Icons

SVG source of truth lives in [`svg/`](svg/). Everything else — the
PNG/ICO/ICNS files Tauri needs at bundle time + the tray state icons
`tray.rs` includes at compile time — is regenerated from these.

## Files this directory needs at build time

Bundle icons (referenced from `tauri.conf.json → bundle.icon`):

- `32x32.png`
- `128x128.png`
- `128x128@2x.png`
- `icon.icns` — macOS bundle icon
- `icon.ico` — Windows installer icon

Tray state icons (referenced by `src/tray.rs` via `include_bytes!`):

- `tray-active.png` (16x16)
- `tray-idle.png` (16x16)
- `tray-offline.png` (16x16)

## Generating them from the SVGs

Requires the Tauri CLI + `librsvg` (macOS: `brew install librsvg`,
Windows: use ImageMagick or Inkscape).

**Bundle icons** — one command handles all sizes + platform variants:

```bash
# Rasterize the master SVG to a 512x512 PNG, then let Tauri generate
# every size + .icns + .ico from it.
rsvg-convert -w 512 -h 512 icons/svg/icon.svg -o /tmp/icon.png
cd desktop-client
npx @tauri-apps/cli icon /tmp/icon.png
```

**Tray state icons** — three separate rasterizations at 16x16:

```bash
rsvg-convert -w 16 -h 16 icons/svg/tray-active.svg  -o icons/tray-active.png
rsvg-convert -w 16 -h 16 icons/svg/tray-idle.svg    -o icons/tray-idle.png
rsvg-convert -w 16 -h 16 icons/svg/tray-offline.svg -o icons/tray-offline.png
```

Some platforms want @2x variants (Retina). Repeat with `-w 32 -h 32`
and name `tray-*@2x.png` if you notice fuzziness on high-DPI Macs.

## Why the PNGs aren't checked in

Binary blobs bloat git history + diffs are meaningless. The SVGs are
the source of truth; every dev + the CI pipeline regenerates the
PNGs on demand from `icons/svg/*.svg`. The GitHub Actions workflow at
`.github/workflows/desktop-client.yml` runs `rsvg-convert` in a build
step so release artifacts always contain freshly rendered icons.

## Debug builds

`src/tray.rs` gates the tray-icon `include_bytes!` behind
`#[cfg(not(debug_assertions))]` — dev builds fall back to
`icon.ico` so `cargo tauri dev` works even without running the PNG
generation step. Release builds require the real files or `cargo
build --release` fails at link time, which is intentional (never ship
a release without tray icons).
