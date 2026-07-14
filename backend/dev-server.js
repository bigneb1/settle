// Local-only dev server that runs the Vercel-style handlers in api/**/*.js
// directly (each exports `GET`/`POST` using Web-standard Request/Response),
// so the frontend preview has a real backend to talk to without needing a
// Vercel account. Vercel itself handles routing/execution in production -
// this file is dev tooling only, never deployed.
import 'dotenv/config'
import http from 'node:http'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const API_DIR = path.join(import.meta.dirname, 'api')
const PORT = Number(process.env.DEV_SERVER_PORT || 8787)

// Mirrors vercel.json's `rewrites` (Vercel applies these in production;
// this file must replicate them locally, or fewer physical route files than
// external URLs - see api/profile/exchange.js and api/profile/identity.js,
// consolidated to fit Vercel Hobby's 12-function-per-deployment cap - would
// 404 in dev even though they work in production). Converts Vercel's `:name`
// path-segment syntax into a regex with named capture groups, then resolves
// the same `:name` placeholders in `destination`'s query string.
const REWRITES = JSON.parse(readFileSync(path.join(import.meta.dirname, 'vercel.json'), 'utf8')).rewrites.map(
  ({ source, destination }) => {
    const paramNames = []
    const pattern = '^' + source.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => {
      paramNames.push(name)
      return '([^/]+)'
    }) + '$'
    return { regex: new RegExp(pattern), paramNames, destination }
  }
)

function applyRewrites(pathname) {
  for (const { regex, paramNames, destination } of REWRITES) {
    const match = pathname.match(regex)
    if (!match) continue
    const params = Object.fromEntries(paramNames.map((name, i) => [name, match[i + 1]]))
    return destination.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => params[name] ?? '')
  }
  return null
}

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

  // Apply the same rewrites vercel.json declares, so a route consolidated
  // into fewer physical files (see REWRITES above) still resolves locally
  // under its original external path. Any query params already on the
  // incoming request are preserved alongside the rewrite's own.
  const rewriteDestination = applyRewrites(url.pathname)
  if (rewriteDestination) {
    const rewritten = new URL(rewriteDestination, url.origin)
    for (const [key, value] of url.searchParams) {
      if (!rewritten.searchParams.has(key)) rewritten.searchParams.set(key, value)
    }
    url.pathname = rewritten.pathname
    url.search = rewritten.search
  }

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
