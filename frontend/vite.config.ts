import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    global: 'globalThis',
    // @particle-network/universal-account-sdk's minified browser bundle
    // references the bare Node global `process` in a couple of spots (a
    // version default and an RPC-URL fallback), via a computed/obfuscated
    // property lookup (`process[<runtime-computed-key>]`) rather than a
    // literal `process.env.X` - a literal `'process.env': {}` replacement
    // doesn't match that computed form, so `process` itself must be
    // replaced. `process` doesn't exist in a browser context and Vite
    // (unlike webpack) doesn't auto-polyfill it, so every Universal Account
    // call (balance fetch, Pay Now, DCA buy, Convert) threw
    // "process is not defined" before this. Same mechanism as the
    // `global: 'globalThis'` line above (a bare-identifier replacement, not
    // a dotted one) - substituting a real object for every reference to
    // `process` makes both the dotted and computed-bracket lookups resolve
    // against a real (empty) `.env`, falling through to their fallback
    // instead of throwing.
    process: '({ env: {} })',
  },
  server: {
    // Allows preview via the cloudflared tunnel (random *.trycloudflare.com host each run).
    // Local/dev-only convenience - not meant to ship.
    allowedHosts: true,
    // Forwards /api/* to the local backend dev-server (backend/dev-server.js,
    // `npm run dev-server`) so same-origin fetch('/api/...') calls work over
    // this same tunnel URL without deploying anything or setting VITE_API_URL.
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        // Forward the real public host/proto (the tunnel URL) to the dev
        // backend - without this, backend/dev-server.js only ever sees
        // 'localhost:8787' as its own request origin, which breaks the
        // GitHub/GitLab OAuth callbacks' redirect_uri computation (it must
        // match the public origin the frontend used for the initial
        // authorize redirect).
        configure: proxy => {
          proxy.on('proxyReq', (proxyReq, req) => {
            if (req.headers.host) proxyReq.setHeader('x-forwarded-host', req.headers.host)
            proxyReq.setHeader('x-forwarded-proto', req.headers['x-forwarded-proto'] || 'http')
          })
        },
      },
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
      '/api': {
        target: 'http://localhost:8787',
        // Forward the real public host/proto (the tunnel URL) to the dev
        // backend - without this, backend/dev-server.js only ever sees
        // 'localhost:8787' as its own request origin, which breaks the
        // GitHub/GitLab OAuth callbacks' redirect_uri computation (it must
        // match the public origin the frontend used for the initial
        // authorize redirect).
        configure: proxy => {
          proxy.on('proxyReq', (proxyReq, req) => {
            if (req.headers.host) proxyReq.setHeader('x-forwarded-host', req.headers.host)
            proxyReq.setHeader('x-forwarded-proto', req.headers['x-forwarded-proto'] || 'http')
          })
        },
      },
    },
  },
})
