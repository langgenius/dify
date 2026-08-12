import { afterEach, describe, expect, it, vi } from 'vitest'
import { canEmbedPath, proxy } from '@/proxy'

const mockEnv = vi.hoisted(() => ({
  NEXT_PUBLIC_ALLOW_EMBED: false,
  NEXT_PUBLIC_CSP_WHITELIST: 'https://example.com',
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: '',
}))

vi.mock('@/env', () => ({
  env: mockEnv,
}))

const createRequest = (url: string) => {
  const nextUrl = new URL(url) as URL & { clone: () => URL }
  nextUrl.clone = () => new URL(nextUrl)

  return {
    headers: new Headers(),
    nextUrl,
  } as Parameters<typeof proxy>[0]
}

describe('proxy frame options', () => {
  afterEach(() => {
    mockEnv.NEXT_PUBLIC_ALLOW_EMBED = false
    mockEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY = ''
    vi.unstubAllEnvs()
  })
  it('should allow embedded share routes', () => {
    expect(canEmbedPath('/chatbot/token')).toBe(true)
    expect(canEmbedPath('/workflow/token')).toBe(true)
    expect(canEmbedPath('/completion/token')).toBe(true)
    expect(canEmbedPath('/webapp-signin')).toBe(true)
    expect(canEmbedPath('/agent/token')).toBe(true)
  })

  it('should deny non-embedded console routes by default', () => {
    expect(canEmbedPath('/agents')).toBe(false)
    expect(canEmbedPath('/agent-settings')).toBe(false)
    expect(canEmbedPath('/agentic')).toBe(false)
    expect(canEmbedPath('/agents/agent-1/access')).toBe(false)
    expect(canEmbedPath('/apps')).toBe(false)
  })

  it('should allow Cloudflare Turnstile resources when its site key is configured', () => {
    vi.stubEnv('NODE_ENV', 'production')
    mockEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'site-key-for-tests'

    const response = proxy(createRequest('https://cloud.dify.ai/signin'))

    expect(response.headers.get('content-security-policy')).toContain(
      'https://challenges.cloudflare.com',
    )
  })
})
