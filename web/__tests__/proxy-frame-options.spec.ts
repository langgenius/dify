import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { canEmbedPath, config, proxy } from '@/proxy'

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

describe('proxy matcher', () => {
  it.each([
    '/',
    '/apps',
    '/apiary',
    '/apps.rsc',
    '/auth/refresh',
    '/chat/app-token',
    '/chat/app-token.js',
    '/console/apiary',
    '/datasets/dataset-id/api',
    '/education/bg.png',
    '/education/apply',
    '/embed.js',
    '/integrations/foo.js',
    '/logo/logo.svg',
    '/marketplace',
    '/pdf.worker.min.mjs',
    '/_next/data/build-id/apps.json',
  ])('keeps Proxy coverage for application and public asset request %s', (url) => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(true)
  })

  it.each([
    '/api',
    '/api/files',
    '/console/api',
    '/console/api/apps',
    '/_next/image?url=%2Flogo%2Flogo.png&w=640&q=75',
    '/_next/static/chunks/app.js',
    '/favicon.ico',
  ])('skips API and static asset request %s', (url) => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(false)
  })

  it('keeps matching route prefetches that need current-path request headers', () => {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: '/apps',
        headers: {
          'next-router-prefetch': '1',
          purpose: 'prefetch',
        },
      }),
    ).toBe(true)
  })

  it('applies the same matcher contract behind a base path', () => {
    const nextConfig = { basePath: '/dify' }

    expect(unstable_doesMiddlewareMatch({ config, nextConfig, url: '/dify/apps' })).toBe(true)
    expect(unstable_doesMiddlewareMatch({ config, nextConfig, url: '/dify/api/files' })).toBe(false)
    expect(unstable_doesMiddlewareMatch({ config, nextConfig, url: '/dify/favicon.ico' })).toBe(
      false,
    )
  })
})

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
