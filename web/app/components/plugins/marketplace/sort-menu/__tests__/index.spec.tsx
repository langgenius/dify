import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider as JotaiProvider } from 'jotai'
import { useMarketplaceSort } from '../../atoms'
import SortMenu from '../index'

const mockTranslation = vi.hoisted(() =>
  vi.fn((key: string, options?: { ns?: string }) => {
    const fullKey = options?.ns ? `${options.ns}.${key}` : key
    const translations: Record<string, string> = {
      'plugin.marketplace.sortBy': 'Sort by',
      'plugin.marketplace.sortOption.mostPopular': 'Most Popular',
      'plugin.marketplace.sortOption.recentlyUpdated': 'Recently Updated',
      'plugin.marketplace.sortOption.newlyReleased': 'Newly Released',
      'plugin.marketplace.sortOption.firstReleased': 'First Released',
    }
    return translations[fullKey] || key
  }),
)

vi.mock('#i18n', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  return {
    useTranslation: () => ({
      t: withSelectorKey(mockTranslation),
    }),
  }
})

function SortStateSubscriber() {
  const [sort] = useMarketplaceSort()
  return (
    <output aria-label="Selected marketplace sort">{`${sort.sortBy}-${sort.sortOrder}`}</output>
  )
}

describe('SortMenu', () => {
  it('updates the shared sort state and preserves the selection when reopened', async () => {
    const user = userEvent.setup()
    render(
      <JotaiProvider>
        <SortMenu />
        <SortStateSubscriber />
      </JotaiProvider>,
    )

    const trigger = screen.getByRole('button', { name: 'Sort by Most Popular' })
    await user.click(trigger)
    const menu = within(await screen.findByRole('menu'))
    expect(menu.getByRole('menuitemradio', { name: 'Most Popular' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await user.click(menu.getByRole('menuitemradio', { name: 'Recently Updated' }))

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sort by Recently Updated' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Selected marketplace sort' })).toHaveTextContent(
      'version_updated_at-DESC',
    )

    await user.click(screen.getByRole('button', { name: 'Sort by Recently Updated' }))
    const reopenedMenu = within(await screen.findByRole('menu'))
    expect(reopenedMenu.getByRole('menuitemradio', { name: 'Recently Updated' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(reopenedMenu.getByRole('menuitemradio', { name: 'Most Popular' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })
})
