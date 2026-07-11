// Local-only dev server that runs the Vercel-style handlers in api/**/*.js
// directly (each exports `GET`/`POST` using Web-standard Request/Response),
// so the frontend preview has a real backend to talk to without needing a
// Vercel account. Vercel itself handles routing/execution in production -
// this file is dev tooling only, never deployed.
import 'dotenv/config'
import http from 'node:http'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const API_DIR = path.join(import.meta.dirname, 'api')
const PORT = Number(process.env.DEV_SERVER_PORT || 8787)

function walk(dir, base = '') {
  const routes = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    const rel = base ? `${base}/${entry}` : entry
    if (statSync(full).isDirectory()) {
      routes.push(...walk(full, rel))
    } else if (entry.endsWith('.js')) {
      routes.push({ routePath: '/api/' + rel.replace(/\.js$/, ''), filePath: full })
    }
  }
  return routes
}

const handlers = new Map()
for (const { routePath, filePath } of walk(API_DIR)) {
  try {
    handlers.set(routePath, await import(pathToFileURL(filePath).href))
    console.log(`[dev-server] registered ${routePath}`)
  } catch (err) {
    console.error(`[dev-server] FAILED to load ${routePath}: ${err.message}`)
  }
}

const server = http.createServer(async (nodeReq, nodeRes) => {
  // Vite's proxy (see frontend/vite.config.ts) sets these two headers so a
  // route can recover the real public origin (the tunnel URL) instead of
  // this process's own localhost address - needed by the GitHub/GitLab
  // OAuth callbacks, which recompute their own redirect_uri from the
  // request URL and must match what the frontend told the OAuth provider
  // during the initial authorize redirect (window.location.origin there).
  const forwardedHost = nodeReq.headers['x-forwarded-host']
  const forwardedProto = nodeReq.headers['x-forwarded-proto'] || 'http'
  const base = forwardedHost ? `${forwardedProto}://${forwardedHost}` : `http://localhost:${PORT}`
  const url = new URL(nodeReq.url, base)

  // Local-only convenience CORS (this server never runs in production).
  nodeRes.setHeader('Access-Control-Allow-Origin', '*')
  nodeRes.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  nodeRes.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
  if (nodeReq.method === 'OPTIONS') {
    nodeRes.writeHead(204)
    nodeRes.end()
    return
  }

  const mod = handlers.get(url.pathname)
  if (!mod) {
    nodeRes.writeHead(404, { 'Content-Type': 'application/json' })
    nodeRes.end(JSON.stringify({ error: `No route for ${url.pathname}` }))
    return
  }
  const handler = mod[nodeReq.method]
  if (!handler) {
    nodeRes.writeHead(405, { 'Content-Type': 'application/json' })
    nodeRes.end(JSON.stringify({ error: `${nodeReq.method} not supported for ${url.pathname}` }))
    return
  }

  try {
    const chunks = []
    for await (const chunk of nodeReq) chunks.push(chunk)
    const body = chunks.length ? Buffer.concat(chunks) : undefined

    const headers = new Headers()
    for (const [key, value] of Object.entries(nodeReq.headers)) {
      if (value != null) headers.set(key, Array.isArray(value) ? value.join(', ') : value)
    }

    const fetchReq = new Request(url, {
      method: nodeReq.method,
      headers,
      body: nodeReq.method === 'GET' || nodeReq.method === 'HEAD' ? undefined : body,
    })

    const fetchRes = await handler(fetchReq)
    nodeRes.writeHead(fetchRes.status, Object.fromEntries(fetchRes.headers))
    nodeRes.end(Buffer.from(await fetchRes.arrayBuffer()))
  } catch (err) {
    console.error(`[dev-server] ${url.pathname} threw:`, err)
    nodeRes.writeHead(500, { 'Content-Type': 'application/json' })
    nodeRes.end(JSON.stringify({ error: 'Internal error (dev-server)', detail: err.message }))
  }
})

server.listen(PORT, () => {
  console.log(`[dev-server] listening on http://localhost:${PORT} (${handlers.size} routes)`)
})
