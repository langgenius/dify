'use client'

/**
 * Public client surface for the standalone Marketplace host (dify-marketplace).
 * Import this module instead of treating private Marketplace paths as Knip entries.
 */
import MarketplaceLiveSearch from '../home/marketplace-live-search'
import {
  MarketplaceSearchAutocomplete,
  MarketplaceSearchForm,
} from '../home/marketplace-search-autocomplete'

export const standaloneMarketplaceClient = {
  MarketplaceLiveSearch,
  MarketplaceSearchAutocomplete,
  MarketplaceSearchForm,
}
