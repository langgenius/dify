import { afterEach, describe, expect, it, vi } from 'vitest'
import { canEmbedPath, proxy } from '@/proxy'

const mockEnv = vi.hoisted(() => ({
  NEXT_PUBLIC_ALLOW_EMBED: false,
  NEXT_PUBLIC_CSP_WHITELIST: 'https://example.com',
}))

vi.mock('@/env', () => ({
  env: mockEnv,
}))

const createRequest = (url: string) =>
  ({
    headers: new Headers(),
    nextUrl: new URL(url),
  }) as Parameters<typeof proxy>[0]

describe('proxy frame options', () => {
  afterEach(() => {
    mockEnv.NEXT_PUBLIC_ALLOW_EMBED = false
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

  it('should protect device routes when global embedding is enabled', () => {
    mockEnv.NEXT_PUBLIC_ALLOW_EMBED = true
    const response = proxy(createRequest('https://cloud.dify.ai/device/code'))

    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
  })
})
