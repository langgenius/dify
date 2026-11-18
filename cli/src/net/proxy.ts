import type { Dispatcher } from 'undici'
import { Agent, EnvHttpProxyAgent } from 'undici'

const PROXY_ENV_KEYS = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy'] as const

export function hasProxyEnv(): boolean {
  return PROXY_ENV_KEYS.some((k) => (process.env[k] ?? '') !== '')
}

export type ProxyDispatcherOptions = {
  // --insecure on a self-signed https:// host: skip certificate verification
  // (local-dev only, same flag that allows plain http:// hosts).
  readonly insecure?: boolean
}

let resolvedKey: string | undefined
let agent: Dispatcher | undefined

// Requests do not automatically read HTTP_PROXY / HTTPS_PROXY / NO_PROXY. When a proxy
// var is set, route requests through an EnvHttpProxyAgent (it also reads the
// lowercase variants and honours NO_PROXY); when none is set and TLS verification
// isn't being skipped, return undefined so undici uses its default dispatcher.
// Resolve once per (proxy env, insecure) combination, fixed for a CLI invocation.
export function proxyDispatcher(opts: ProxyDispatcherOptions = {}): Dispatcher | undefined {
  const insecure = opts.insecure ?? false
  const key = `${hasProxyEnv()}:${insecure}`
  if (resolvedKey !== key) {
    const tls = insecure ? { rejectUnauthorized: false } : undefined
    agent = hasProxyEnv()
      ? new EnvHttpProxyAgent({
          // Preserve the CONNECT behavior used before the undici v8 migration.
          proxyTunnel: true,
          ...(tls !== undefined ? { connect: tls, requestTls: tls, proxyTls: tls } : {}),
        })
      : tls !== undefined
        ? new Agent({ connect: tls })
        : undefined
    resolvedKey = key
  }
  return agent
}
