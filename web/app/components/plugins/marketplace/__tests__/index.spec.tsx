import { describe, it } from 'vitest'

// The Marketplace index component is an async Server Component
// that cannot be unit tested in jsdom. It is covered by integration tests.
//
// All sub-module tests have been moved to dedicated spec files:
// - constants.spec.ts (DEFAULT_SORT, SCROLL_BOTTOM_THRESHOLD, PLUGIN_TYPE_SEARCH_MAP)
// - utils.spec.ts (getPluginIconInMarketplace, getFormattedPlugin, getPluginLinkInMarketplace, etc.)
// - hooks.spec.tsx (useMarketplaceCollectionsAndPlugins, useMarketplacePlugins, useMarketplaceContainerScroll)

describe('Marketplace index', () => {
  it('should be covered by dedicated sub-module specs', () => {
    // Placeholder to document the split
  })
})
