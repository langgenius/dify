import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { MarketplacePluginSearch } from '../search-input'

const markFilter = vi.hoisted(() => vi.fn())
vi.mock('@/utils/marketplace-site-track', () => ({
  markMarketplaceSiteFilter: markFilter,
}))

describe('MarketplacePluginSearch', () => {
  it('clears the query and tags independently in the URL and tracks tag changes', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = renderWithNuqs(<MarketplacePluginSearch />, {
      searchParams: '?q=agent&tags=rag',
    })
    await user.click(screen.getByRole('button', { name: /^plugin\.clearSearch/ }))
    await waitFor(() => {
      const params = onUrlUpdate.mock.calls.at(-1)?.[0].searchParams
      expect(params?.get('q')).toBeNull()
      expect(params?.get('tags')).toBe('rag')
    })
    expect(markFilter).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /^pluginTags\.clearSelectedTags/ }))
    await waitFor(() => {
      expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('tags')).toBeNull()
    })
    expect(markFilter).toHaveBeenCalledExactlyOnceWith({
      filter_type: 'category',
      selection_mode: 'multi',
      filter_value: 'rag',
      selected_values: [],
    })
  })
})
