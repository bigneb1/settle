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
    // Local/dev-only convenience — not meant to ship.
    allowedHosts: true,
  },
})
