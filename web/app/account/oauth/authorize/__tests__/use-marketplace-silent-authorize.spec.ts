import { afterEach, describe, expect, it, vi } from 'vitest'
import { shouldSilentAuthorizeMarketplace } from '../use-marketplace-silent-authorize'

const mocks = vi.hoisted(() => ({
  marketplaceOAuthClientId: 'marketplace-client',
}))

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
    get MARKETPLACE_OAUTH_CLIENT_ID() {
      return mocks.marketplaceOAuthClientId
    },
  }
})

describe('shouldSilentAuthorizeMarketplace', () => {
  afterEach(() => {
    mocks.marketplaceOAuthClientId = 'marketplace-client'
  })

  it('selects the configured Cloud Marketplace client', () => {
    expect(
      shouldSilentAuthorizeMarketplace({
        clientId: 'marketplace-client',
        deploymentEdition: 'CLOUD',
      }),
    ).toBe(true)
  })

  it('does not select Community or a different client', () => {
    expect(
      shouldSilentAuthorizeMarketplace({
        clientId: 'marketplace-client',
        deploymentEdition: 'COMMUNITY',
      }),
    ).toBe(false)
    expect(
      shouldSilentAuthorizeMarketplace({
        clientId: 'other-client',
        deploymentEdition: 'CLOUD',
      }),
    ).toBe(false)
  })

  it('does not select a Marketplace-looking client when the env is unset', () => {
    mocks.marketplaceOAuthClientId = ''

    expect(
      shouldSilentAuthorizeMarketplace({
        clientId: 'marketplace-client',
        deploymentEdition: 'CLOUD',
      }),
    ).toBe(false)
  })
})
