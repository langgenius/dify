import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { loadEnv } from 'vite'
import { createDevProxyApp, resolveDevProxyTargets } from '../plugins/dev-proxy/server'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mode = process.env.MODE || process.env.NODE_ENV || 'development'
const env = loadEnv(mode, projectRoot, '')

const host = env.HONO_PROXY_HOST || '127.0.0.1'
const port = Number(env.HONO_PROXY_PORT || 5001)
const app = createDevProxyApp(resolveDevProxyTargets(env))

serve({
  fetch: app.fetch,
  hostname: host,
  port,
})

console.log(`[dev-hono-proxy] listening on http://${host}:${port}`)
