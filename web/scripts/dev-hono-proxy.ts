import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { loadEnv } from 'vite'
import { parseDevProxyCliArgs, resolveDevProxyServerOptions } from '../plugins/dev-proxy/config'
import { createDevProxyApp, resolveDevProxyTargets } from '../plugins/dev-proxy/server'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mode = process.env.MODE || process.env.NODE_ENV || 'development'
const env = loadEnv(mode, projectRoot, '')
const cliOptions = parseDevProxyCliArgs(process.argv.slice(2))
const { host, port, proxyTarget } = resolveDevProxyServerOptions(env, cliOptions)

const app = createDevProxyApp(resolveDevProxyTargets(env))

serve({
  fetch: app.fetch,
  hostname: host,
  port,
})

console.log(`[dev-hono-proxy] target=${proxyTarget} listening on http://${host}:${port}`)
