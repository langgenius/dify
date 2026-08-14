import { afterEach, describe, expect, it, vi } from 'vitest'
import { canEmbedPath, proxy } from '@/proxy'

const mockEnv = vi.hoisted(() => ({
  NEXT_PUBLIC_ALLOW_EMBED: false,
  NEXT_PUBLIC_CSP_WHITELIST: 'https://example.com',
  NEXT_PUBLIC_MARKETPLACE_URL_PREFIX: '',
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
    mockEnv.NEXT_PUBLIC_MARKETPLACE_URL_PREFIX = ''
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
    expect(canEmbedPath('/chatty')).toBe(false)
    expect(canEmbedPath('/workflowish')).toBe(false)
    expect(canEmbedPath('/completionist')).toBe(false)
    expect(canEmbedPath('/webapp-signing')).toBe(false)
    expect(canEmbedPath('/agents')).toBe(false)
    expect(canEmbedPath('/agent-settings')).toBe(false)
    expect(canEmbedPath('/agentic')).toBe(false)
    expect(canEmbedPath('/agents/agent-1/access')).toBe(false)
    expect(canEmbedPath('/apps')).toBe(false)
  })

  it('should enforce frame ancestors on protected document routes', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const response = proxy(createRequest('https://cloud.dify.ai/device'))
    const contentSecurityPolicy = response.headers.get('content-security-policy')

    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(contentSecurityPolicy).toContain("script-src 'self'")
    expect(contentSecurityPolicy).toContain("frame-ancestors 'none'")
  })

  it('should keep published app routes embeddable', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const response = proxy(createRequest('https://udify.app/chat/test-token'))
    const contentSecurityPolicy = response.headers.get('content-security-policy')

    expect(response.headers.get('x-frame-options')).toBeNull()
    expect(contentSecurityPolicy).toContain("script-src 'self'")
    expect(contentSecurityPolicy).not.toContain('frame-ancestors')
  })

  it('should allow Cloudflare Turnstile resources when its site key is configured', () => {
    vi.stubEnv('NODE_ENV', 'production')
    mockEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'site-key-for-tests'

    const response = proxy(createRequest('https://cloud.dify.ai/signin'))

    expect(response.headers.get('content-security-policy')).toContain(
      'https://challenges.cloudflare.com',
    )
  })

  it('should protect device routes when global embedding is enabled', () => {
    mockEnv.NEXT_PUBLIC_ALLOW_EMBED = true
    const response = proxy(createRequest('https://cloud.dify.ai/device/code'))

    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
  })

  it('should deny framing for the Marketplace OAuth authorize route', () => {
    const response = proxy(
      createRequest(
        'https://cloud.dify.ai/account/oauth/authorize?client_id=marketplace-client',
      ),
    )

    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
  })

  it('should allow framing Marketplace pages when a Marketplace origin is configured', () => {
    vi.stubEnv('NODE_ENV', 'production')
    mockEnv.NEXT_PUBLIC_MARKETPLACE_URL_PREFIX = 'https://marketplace.dify.ai'

    const response = proxy(createRequest('https://cloud.dify.ai/marketplace'))

    expect(response.headers.get('content-security-policy') ?? '').toMatch(
      /frame-src[^;]*https:\/\/marketplace\.dify\.ai/,
    )
  })

  it('should not add a Marketplace frame origin when the prefix is unset', () => {
    vi.stubEnv('NODE_ENV', 'production')

    const response = proxy(createRequest('https://cloud.dify.ai/marketplace'))
    const contentSecurityPolicy = response.headers.get('content-security-policy') ?? ''

    expect(contentSecurityPolicy).toContain('frame-src')
    expect(contentSecurityPolicy).not.toContain('https://marketplace.dify.ai')
  })
})

describe('proxy education entry normalization', () => {
  it('redirects the legacy education action without leaking it into the canonical URL', () => {
    const response = proxy(
      createRequest('https://cloud.dify.ai/?action=getEducationVerify&utm_source=education-site'),
    )

    expect(response.status).toBe(308)
    expect(response.headers.get('location')).toBe(
      'https://cloud.dify.ai/education/verify?utm_source=education-site',
    )
  })

  it('does not redirect unrelated actions or paths', () => {
    const unrelatedAction = proxy(createRequest('https://cloud.dify.ai/?action=showSettings'))
    const unrelatedPath = proxy(
      createRequest('https://cloud.dify.ai/apps?action=getEducationVerify'),
    )

    expect(unrelatedAction.status).toBe(200)
    expect(unrelatedPath.status).toBe(200)
  })
})
