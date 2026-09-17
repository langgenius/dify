import { describe, expect, it, vi } from 'vite-plus/test'
import { standaloneMarketplaceClient } from '../client'
import { standaloneMarketplaceServer } from '../server'

vi.mock('../../index', () => ({ default: () => null }))
vi.mock('../../hydration-server', () => ({
  HydrateQueryClient: () => null,
}))

vi.mock('../../prefetch-marketplace-dehydrated-state', () => ({
  prefetchMarketplaceDehydratedState: vi.fn(),
}))

describe('standalone Marketplace host entry', () => {
  it('exports the client search surface', () => {
    expect(standaloneMarketplaceClient.MarketplaceLiveSearch).toEqual(expect.any(Function))
    expect(standaloneMarketplaceClient.MarketplaceSearchAutocomplete).toEqual(expect.any(Function))
  })

  it('exports the server prefetch helpers and creator model', () => {
    expect(standaloneMarketplaceServer.withinServerBudget).toEqual(expect.any(Function))
    expect(standaloneMarketplaceServer.prefetchMarketplaceDehydratedState).toEqual(
      expect.any(Function),
    )
    expect(standaloneMarketplaceServer.SERVER_PREFETCH_BUDGET_MS).toBeGreaterThan(0)
    expect(standaloneMarketplaceServer.parseCreatorSortField('popularity')).toBe('popularity')
  })
})
