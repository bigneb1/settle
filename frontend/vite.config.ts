import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    global: 'globalThis',
  },
  server: {
    // Allows preview via the cloudflared tunnel (random *.trycloudflare.com host each run).
    // Local/dev-only convenience - not meant to ship.
    allowedHosts: true,
    // Forwards /api/* to the local backend dev-server (backend/dev-server.js,
    // `npm run dev-server`) so same-origin fetch('/api/...') calls work over
    // this same tunnel URL without deploying anything or setting VITE_API_URL.
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  // `vite preview` (serves the built dist/) reads its own config, separate
  // from `server` above - mirrored here so tunnel-based testing against a
  // production build works the same way. Vite's dev server serves every
  // module as its own uncompiled HTTP request, which is a lot of chatty
  // small requests for a free Cloudflare quick tunnel to carry reliably;
  // the bundled preview build is a handful of larger, hashed files and
  // holds up much better for sustained multi-page browsing over a tunnel.
  preview: {
    allowedHosts: true,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
