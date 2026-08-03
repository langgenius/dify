import { describe, expect, it } from 'vitest'
import { canEmbedPath, getMarketplaceOAuthFrameOrigin } from '@/proxy'

describe('proxy frame options', () => {
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

  it('allows only the configured Marketplace OAuth flow to be framed by Marketplace', () => {
    const url = new URL(
      'https://cloud.dify.ai/account/oauth/authorize?client_id=marketplace-client&flow=marketplace',
    )

    expect(
      getMarketplaceOAuthFrameOrigin(url, {
        marketplaceClientId: 'marketplace-client',
        marketplaceUrlPrefix: 'https://marketplace.dify.ai',
      }),
    ).toBe('https://marketplace.dify.ai')

    url.searchParams.set('client_id', 'another-client')
    expect(
      getMarketplaceOAuthFrameOrigin(url, {
        marketplaceClientId: 'marketplace-client',
        marketplaceUrlPrefix: 'https://marketplace.dify.ai',
      }),
    ).toBe('')
  })

  it('allows only HTTP(S) Marketplace origins', () => {
    const url = new URL(
      'https://cloud.dify.ai/account/oauth/authorize?client_id=marketplace-client&flow=marketplace',
    )

    expect(
      getMarketplaceOAuthFrameOrigin(url, {
        marketplaceClientId: 'marketplace-client',
        marketplaceUrlPrefix: 'javascript:alert(1)',
      }),
    ).toBe('')
  })
})
