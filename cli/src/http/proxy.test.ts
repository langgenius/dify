import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const PROXY_KEYS = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy'] as const

describe('proxyDispatcher', () => {
  const saved = new Map<string, string | undefined>()

  beforeEach(() => {
    for (const k of PROXY_KEYS) {
      saved.set(k, process.env[k])
      delete process.env[k]
    }
    // proxyDispatcher memoizes per module instance; reset so each case re-resolves.
    vi.resetModules()
  })

  afterEach(() => {
    for (const k of PROXY_KEYS) {
      const v = saved.get(k)
      if (v === undefined)
        delete process.env[k]
      else
        process.env[k] = v
    }
  })

  it('returns undefined and reports no proxy when env is clean', async () => {
    const { proxyDispatcher, hasProxyEnv } = await import('./proxy.js')
    expect(hasProxyEnv()).toBe(false)
    expect(proxyDispatcher()).toBeUndefined()
  })

  it('builds an EnvHttpProxyAgent when HTTP_PROXY is set', async () => {
    process.env.HTTP_PROXY = 'http://127.0.0.1:8888'
    const { proxyDispatcher, hasProxyEnv } = await import('./proxy.js')
    expect(hasProxyEnv()).toBe(true)
    const d = proxyDispatcher()
    expect(d?.constructor.name).toBe('EnvHttpProxyAgent')
    await d?.close()
  })

  it('detects the lowercase https_proxy variant', async () => {
    process.env.https_proxy = 'http://127.0.0.1:8888'
    const { hasProxyEnv } = await import('./proxy.js')
    expect(hasProxyEnv()).toBe(true)
  })

  it('memoizes the resolved dispatcher across calls', async () => {
    process.env.HTTPS_PROXY = 'http://127.0.0.1:8888'
    const { proxyDispatcher } = await import('./proxy.js')
    const first = proxyDispatcher()
    expect(proxyDispatcher()).toBe(first)
    await first?.close()
  })
})
