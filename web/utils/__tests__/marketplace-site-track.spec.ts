import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { trackMarketplaceSiteCardClick, trackMarketplaceSiteEvent } from '../marketplace-site-track'

describe('marketplace site track bridge', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-is-marketplace')
    delete window.__marketplaceTracking__
  })

  it.each([
    ['without the host marker', undefined],
    ['on the Dify console runtime dataset', 'false'],
  ])('does not forward events %s', (_label, marker) => {
    if (marker !== undefined) document.documentElement.setAttribute('data-is-marketplace', marker)
    const track = vi.fn()
    window.__marketplaceTracking__ = {
      track,
      rememberReferrer: vi.fn(),
      markSearch: vi.fn(),
      flushSearch: vi.fn(),
      markFilter: vi.fn(),
      flushFilter: vi.fn(),
    }

    trackMarketplaceSiteEvent('marketplace_card_click', { click_target: 'card' })

    expect(track).not.toHaveBeenCalled()
  })

  it('forwards events and card clicks on the standalone marketplace', () => {
    const track = vi.fn()
    const rememberReferrer = vi.fn()
    document.documentElement.setAttribute('data-is-marketplace', '')
    window.__marketplaceTracking__ = {
      track,
      rememberReferrer,
      markSearch: vi.fn(),
      flushSearch: vi.fn(),
      markFilter: vi.fn(),
      flushFilter: vi.fn(),
    }

    trackMarketplaceSiteEvent('marketplace_creator_partner_click', {
      click_target: 'creator_center',
    })
    trackMarketplaceSiteCardClick({
      itemId: 'org/name',
      itemType: 'plugin',
      itemName: 'OpenAI',
      section: 'partners',
    })
    expect(track).toHaveBeenNthCalledWith(1, 'marketplace_creator_partner_click', {
      click_target: 'creator_center',
    })
    expect(rememberReferrer).toHaveBeenCalledWith('org/name', 'list')
    expect(track).toHaveBeenNthCalledWith(2, 'marketplace_card_click', {
      click_target: 'card',
      item_id: 'org/name',
      item_type: 'plugin',
      item_name: 'OpenAI',
      section: 'partners',
    })
  })
})
