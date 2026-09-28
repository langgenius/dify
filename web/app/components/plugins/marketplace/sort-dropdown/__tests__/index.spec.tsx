import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SortDropdown from '../index'

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

let mockSort: { sortBy: string; sortOrder: string } = { sortBy: 'install_count', sortOrder: 'DESC' }
const mockHandleSortChange = vi.fn()

vi.mock('../../atoms', () => ({
  useMarketplaceSort: () => [mockSort, mockHandleSortChange],
}))

describe('SortDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSort = { sortBy: 'install_count', sortOrder: 'DESC' }
  })

  it('renders the selected sort option in the trigger', () => {
    render(<SortDropdown />)

    const trigger = screen.getByRole('button', { name: 'Sort by Most Popular' })
    expect(within(trigger).getByText('Sort by')).toBeInTheDocument()
    expect(within(trigger).getByText('Most Popular')).toBeInTheDocument()
  })

  it('falls back to the default option when the current sort is invalid', () => {
    mockSort = { sortBy: 'unknown', sortOrder: 'ASC' }

    render(<SortDropdown />)

    expect(screen.getByText('Most Popular')).toBeInTheDocument()
  })

  it('opens the menu and renders all sort options', async () => {
    const user = userEvent.setup()
    render(<SortDropdown />)

    await user.click(screen.getByRole('button', { name: 'Sort by Most Popular' }))

    const content = await screen.findByRole('menu')
    expect(within(content).getByText('Most Popular')).toBeInTheDocument()
    expect(within(content).getByText('Recently Updated')).toBeInTheDocument()
    expect(within(content).getByText('Newly Released')).toBeInTheDocument()
    expect(within(content).getByText('First Released')).toBeInTheDocument()
  })

  it('shows a check icon for the currently selected option', async () => {
    const user = userEvent.setup()
    render(<SortDropdown />)

    await user.click(screen.getByRole('button', { name: 'Sort by Most Popular' }))

    expect(document.querySelector('.i-ri-check-line')).toBeInTheDocument()
  })

  it('updates the sort and closes the menu when an option is selected', async () => {
    const user = userEvent.setup()
    render(<SortDropdown />)

    await user.click(screen.getByRole('button', { name: 'Sort by Most Popular' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Recently Updated' }))

    expect(mockHandleSortChange).toHaveBeenCalledWith({
      sortBy: 'version_updated_at',
      sortOrder: 'DESC',
    })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
