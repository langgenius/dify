import { describe, expect, it } from 'vitest'
import {
  getCreatorCenterUrl,
  PUBLIC_CREATOR_CENTER_URL,
  rewriteMarketplaceOriginToCreators,
} from '../creator-center-url'

describe('getCreatorCenterUrl', () => {
  it('maps the public Marketplace to the public Creator Center', () => {
    expect(getCreatorCenterUrl('https://marketplace.dify.ai')).toBe('https://creators.dify.ai/')
  })

  it('maps marketplace.dify.dev to creators.dify.dev', () => {
    expect(getCreatorCenterUrl('https://marketplace.dify.dev')).toBe('https://creators.dify.dev/')
  })

  it('keeps the staging suffix on the Creators host', () => {
    expect(getCreatorCenterUrl('https://marketplace-staging.dify.dev')).toBe(
      'https://creators-staging.dify.dev/',
    )
  })

  it('falls back to the public Creator Center for localhost', () => {
    expect(getCreatorCenterUrl('http://localhost:3000')).toBe(PUBLIC_CREATOR_CENTER_URL)
  })

  it('falls back to the public Creator Center when the prefix is empty', () => {
    expect(getCreatorCenterUrl('')).toBe(PUBLIC_CREATOR_CENTER_URL)
  })

  it('prefers the current Marketplace page over a stale configured prefix', () => {
    expect(getCreatorCenterUrl('https://marketplace.dify.ai', 'https://marketplace.dify.dev')).toBe(
      'https://creators.dify.dev/',
    )
  })
})

describe('rewriteMarketplaceOriginToCreators', () => {
  it('returns null for hosts that are not a Marketplace surface', () => {
    expect(rewriteMarketplaceOriginToCreators('https://cloud.dify.ai')).toBeNull()
    expect(rewriteMarketplaceOriginToCreators('http://localhost:3000')).toBeNull()
    expect(rewriteMarketplaceOriginToCreators('')).toBeNull()
  })
})
