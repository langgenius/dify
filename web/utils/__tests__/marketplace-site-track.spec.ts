// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  markMarketplaceSiteFilter,
  markMarketplaceSiteSearch,
  trackMarketplaceSiteCardClick,
  trackMarketplaceSiteEvent,
} from '../marketplace-site-track'

describe('marketplace site track bridge', () => {
  afterEach(() => {
    document.body.removeAttribute('data-is-marketplace')
    delete window.__marketplaceTracking__
  })

  it('does not forward events outside the standalone marketplace', () => {
    const track = vi.fn()
    window.__marketplaceTracking__ = { track } as never

    trackMarketplaceSiteEvent('marketplace_card_click', { click_target: 'card' })

    expect(track).not.toHaveBeenCalled()
  })

  it('forwards events and card clicks on the standalone marketplace', () => {
    const track = vi.fn()
    const rememberReferrer = vi.fn()
    document.body.setAttribute('data-is-marketplace', '')
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
      section: 'partners',
    })
    markMarketplaceSiteSearch('openai')
    markMarketplaceSiteFilter({
      filter_type: 'type_tab',
      selection_mode: 'single',
      filter_value: 'tool',
      selected_values: ['tool'],
    })

    expect(track).toHaveBeenNthCalledWith(1, 'marketplace_creator_partner_click', {
      click_target: 'creator_center',
    })
    expect(rememberReferrer).toHaveBeenCalledWith('org/name', 'list')
    expect(track).toHaveBeenNthCalledWith(2, 'marketplace_card_click', {
      click_target: 'card',
      item_id: 'org/name',
      item_type: 'plugin',
      section: 'partners',
    })
  })
})
