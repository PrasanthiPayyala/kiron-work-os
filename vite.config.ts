import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "prompt",
      // Enable SW in dev so the "Install app" prompt and offline test work via `npm run dev`.
      devOptions: { enabled: true, type: "module" },
      includeAssets: ["favicon.ico", "robots.txt", "icons/kiron-icon.svg"],
      manifest: {
        name: "Kiron Work OS",
        short_name: "Kiron",
        description: "Kiron Group internal operations — projects, tasks, attendance, approvals.",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        start_url: "/dashboard",
        scope: "/",
        icons: [
          { src: "/icons/kiron-icon.svg",     sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "/icons/kiron-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        navigateFallback: "/index.html",
        // Paths the React SW must NOT hijack:
        //   /api  → FastAPI backend (proxied by nginx/Apache).
        //   /ws   → WebSocket upgrade endpoint.
        //   /old/ → legacy PHP CRM (RISE) co-hosted under the same origin.
        //           Without this, the SW serves the React /index.html shell for
        //           every /old/* navigation, blanking the page after login.
        // Offline DATA is served from IndexedDB (see src/lib/offline), not the
        // SW HTTP cache, so we deliberately do NOT cache /api responses here —
        // that would risk serving stale rows over the live store.
        navigateFallbackDenylist: [/^\/api/, /^\/ws$/, /^\/old(\/|$)/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === "image" || request.destination === "font",
            handler: "CacheFirst",
            options: {
              cacheName: "static-assets",
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
