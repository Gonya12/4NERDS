import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };
const buildTime = new Date().toISOString();

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/tesseract.js") || id.includes("node_modules/tesseract.js-core")) return "scanner-tesseract";
        }
      }
    }
  },
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __APP_BUILD_TIME__: JSON.stringify(buildTime)
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["pwa-192.png", "pwa-512.png"],
      manifest: {
        name: "4 Nerds Event Tracker",
        short_name: "4 Nerds",
        description: "Shared Pokemon and TCG vendor event tracker.",
        theme_color: "#f8fafc",
        background_color: "#f8fafc",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "/pwa-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any maskable"
          },
          {
            src: "/pwa-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        navigateFallback: "/",
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        globIgnores: [
          "**/scanner-*.js",
          "**/cardScanService-*.js",
          "**/cardImageProcessor-*.js",
          "**/cardImageWorker-*.js",
          "**/CardScanPanel-*.js",
          "**/BatchInventoryImporter-*.js",
          "**/TcgplayerPricingPanel-*.js"
        ],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "supabase-runtime",
              expiration: {
                maxEntries: 80,
                maxAgeSeconds: 60 * 60
              },
              networkTimeoutSeconds: 8
            }
          }
        ]
      }
    })
  ],
});
