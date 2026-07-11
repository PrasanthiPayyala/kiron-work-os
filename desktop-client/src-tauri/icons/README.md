# Icons

Placeholder — real icons land in Session 5 (distribution). To unblock a local
`cargo tauri dev` before then, either:

1. Copy any 512x512 PNG into this directory and run
   `npx @tauri-apps/cli icon icon.png` — Tauri will regenerate every size + the
   `.ico` / `.icns` variants automatically.
2. Or skip icons: temporarily remove the `"icon": [...]` array from
   `../tauri.conf.json` and Tauri will use its default icon during dev.

Session 5 will drop the real Kiron logo here (SVG source + rendered
sizes), commit them alongside the signed-installer manifest.
