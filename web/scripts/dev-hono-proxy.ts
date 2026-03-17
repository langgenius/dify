import { createSecureServer } from 'node:http2'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { getCertificate } from '@vitejs/plugin-basic-ssl'
import { loadEnv } from 'vite'
import { createDevProxyApp, resolveDevProxyTargets, shouldUseHttpsForDevProxy } from '../plugins/dev-proxy/server'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mode = process.env.MODE || process.env.NODE_ENV || 'development'
const env = loadEnv(mode, projectRoot, '')

const host = env.HONO_PROXY_HOST || '127.0.0.1'
const port = Number(env.HONO_PROXY_PORT || 5001)
const app = createDevProxyApp(resolveDevProxyTargets(env))
const useHttps = shouldUseHttpsForDevProxy(env)

if (useHttps) {
  const certificate = await getCertificate(
    path.join(projectRoot, 'node_modules/.vite/basic-ssl'),
    'localhost',
    Array.from(new Set(['localhost', '127.0.0.1', host])),
  )

  serve({
    fetch: app.fetch,
    hostname: host,
    port,
    createServer: createSecureServer,
    serverOptions: {
      allowHTTP1: true,
      cert: certificate,
      key: certificate,
    },
  })
}
else {
  serve({
    fetch: app.fetch,
    hostname: host,
    port,
  })
}

console.log(`[dev-hono-proxy] listening on ${useHttps ? 'https' : 'http'}://${host}:${port}`)
