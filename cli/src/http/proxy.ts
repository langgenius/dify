import { EnvHttpProxyAgent } from 'undici'

const PROXY_ENV_KEYS = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy'] as const

export function hasProxyEnv(): boolean {
  return PROXY_ENV_KEYS.some(k => (process.env[k] ?? '') !== '')
}

let resolved = false
let agent: EnvHttpProxyAgent | undefined

// Node's global fetch ignores HTTP_PROXY / HTTPS_PROXY / NO_PROXY. When a proxy
// var is set, route requests through an EnvHttpProxyAgent (it also reads the
// lowercase variants and honours NO_PROXY); when none is set, return undefined so
// fetch keeps Node's default global dispatcher untouched. Resolved once per
// process — proxy env vars are fixed for a single CLI invocation.
export function proxyDispatcher(): EnvHttpProxyAgent | undefined {
  if (!resolved) {
    agent = hasProxyEnv() ? new EnvHttpProxyAgent() : undefined
    resolved = true
  }
  return agent
}
