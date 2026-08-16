import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vite-plus/test'
import { renderWithNuqs } from '@/test/nuqs-testing'
import MarketplacePluginSearch from '../marketplace-plugin-search'

describe('MarketplacePluginSearch', () => {
  it('updates the catalog query as the user types without opening suggestions', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = renderWithNuqs(<MarketplacePluginSearch placeholder="Search plugins" />)

    const input = screen.getByRole('searchbox', { name: 'Search plugins' })
    await user.type(input, 'google')

    expect(input).toHaveValue('google')
    await waitFor(() => {
      expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('q')).toBe('google')
    })
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
