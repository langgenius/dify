type MarketplaceSiteReferrerSection = 'banner' | 'search' | 'list' | 'direct'

type MarketplaceSiteFilter = {
  filter_type: 'type_tab' | 'category' | 'language'
  selection_mode: 'single' | 'multi'
  filter_value: string
  selected_values: string[]
}

const isMarketplaceSite = () => (
  typeof globalThis.document !== 'undefined'
  && globalThis.document.body?.hasAttribute('data-is-marketplace')
)

const marketplaceTracking = () => globalThis.window.__marketplaceTracking__

export const trackMarketplaceSiteEvent = (
  eventName: string,
  properties?: Record<string, unknown>,
) => {
  if (!isMarketplaceSite())
    return

  marketplaceTracking()?.track(eventName, properties)
}

export const rememberMarketplaceSiteReferrer = (
  itemId: string,
  section: MarketplaceSiteReferrerSection,
) => {
  if (!isMarketplaceSite())
    return

  marketplaceTracking()?.rememberReferrer(itemId, section)
}

export const markMarketplaceSiteSearch = (query: string) => {
  if (!isMarketplaceSite())
    return

  marketplaceTracking()?.markSearch(query)
}

export const flushMarketplaceSiteSearch = (resultCount: number) => {
  if (!isMarketplaceSite())
    return

  marketplaceTracking()?.flushSearch(resultCount)
}

export const markMarketplaceSiteFilter = (filter: MarketplaceSiteFilter) => {
  if (!isMarketplaceSite())
    return

  marketplaceTracking()?.markFilter(filter)
}

export const flushMarketplaceSiteFilter = (resultCount: number) => {
  if (!isMarketplaceSite())
    return

  marketplaceTracking()?.flushFilter(resultCount)
}

export const trackMarketplaceSiteCardClick = ({
  itemId,
  itemType,
  section,
}: {
  itemId: string
  itemType: 'plugin' | 'template'
  section: string
}) => {
  rememberMarketplaceSiteReferrer(itemId, section === 'search' ? 'search' : 'list')
  trackMarketplaceSiteEvent('marketplace_card_click', {
    click_target: 'card',
    item_id: itemId,
    item_type: itemType,
    section,
  })
}
