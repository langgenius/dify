import type {
  MouseEventHandler,
  ReactNode,
} from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SortDropdown from '../index'

const mockTranslation = vi.fn((key: string, options?: { ns?: string }) => {
  const fullKey = options?.ns ? `${options.ns}.${key}` : key
  const translations: Record<string, string> = {
    'plugin.marketplace.sortBy': 'Sort by',
    'plugin.marketplace.sortOption.mostPopular': 'Most Popular',
    'plugin.marketplace.sortOption.recentlyUpdated': 'Recently Updated',
    'plugin.marketplace.sortOption.newlyReleased': 'Newly Released',
    'plugin.marketplace.sortOption.firstReleased': 'First Released',
  }
  return translations[fullKey] || key
})

vi.mock('#i18n', () => ({
  useTranslation: () => ({
    t: mockTranslation,
  }),
}))

let mockSort: { sortBy: string, sortOrder: string } = { sortBy: 'install_count', sortOrder: 'DESC' }
const mockHandleSortChange = vi.fn()

vi.mock('../../atoms', () => ({
  useMarketplaceSort: () => [mockSort, mockHandleSortChange],
}))

vi.mock('@/app/components/base/ui/dropdown-menu', async () => {
  const React = await import('react')
  const DropdownMenuContext = React.createContext<{ open: boolean, setOpen: (open: boolean) => void } | null>(null)

  const useDropdownMenuContext = () => {
    const context = React.use(DropdownMenuContext)
    if (!context)
      throw new Error('DropdownMenu components must be wrapped in DropdownMenu')
    return context
  }

  return {
    DropdownMenu: ({ children, open, onOpenChange }: { children: ReactNode, open: boolean, onOpenChange?: (open: boolean) => void }) => (
      <DropdownMenuContext value={{ open, setOpen: onOpenChange ?? vi.fn() }}>
        <div data-testid="dropdown-wrapper" data-open={open}>
          {children}
        </div>
      </DropdownMenuContext>
    ),
    DropdownMenuTrigger: ({ children, className }: { children: ReactNode, className?: string }) => {
      const { open, setOpen } = useDropdownMenuContext()
      return (
        <button
          type="button"
          className={className}
          data-testid="dropdown-trigger"
          onClick={() => setOpen(!open)}
        >
          {children}
        </button>
      )
    },
    DropdownMenuContent: ({ children }: { children: ReactNode }) => {
      const { open } = useDropdownMenuContext()
      return open ? <div data-testid="dropdown-content">{children}</div> : null
    },
    DropdownMenuItem: ({
      children,
      onClick,
      className,
    }: {
      children: ReactNode
      onClick?: MouseEventHandler<HTMLButtonElement>
      className?: string
    }) => {
      const { setOpen } = useDropdownMenuContext()
      return (
        <button
          type="button"
          className={className}
          onClick={(event) => {
            onClick?.(event)
            setOpen(false)
          }}
        >
          {children}
        </button>
      )
    },
  }
})

describe('SortDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSort = { sortBy: 'install_count', sortOrder: 'DESC' }
  })

  it('renders the selected sort option in the trigger', () => {
    render(<SortDropdown />)

    const trigger = screen.getByTestId('dropdown-trigger')
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

    await user.click(screen.getByTestId('dropdown-trigger'))

    const content = screen.getByTestId('dropdown-content')
    expect(within(content).getByText('Most Popular')).toBeInTheDocument()
    expect(within(content).getByText('Recently Updated')).toBeInTheDocument()
    expect(within(content).getByText('Newly Released')).toBeInTheDocument()
    expect(within(content).getByText('First Released')).toBeInTheDocument()
  })

  it('shows a check icon for the currently selected option', async () => {
    const user = userEvent.setup()
    const { container } = render(<SortDropdown />)

    await user.click(screen.getByTestId('dropdown-trigger'))

    expect(container.querySelector('.i-ri-check-line')).toBeInTheDocument()
  })

  it('updates the sort and closes the menu when an option is selected', async () => {
    const user = userEvent.setup()
    render(<SortDropdown />)

    await user.click(screen.getByTestId('dropdown-trigger'))
    await user.click(screen.getByText('Recently Updated'))

    expect(mockHandleSortChange).toHaveBeenCalledWith({
      sortBy: 'version_updated_at',
      sortOrder: 'DESC',
    })
    expect(screen.queryByTestId('dropdown-content')).not.toBeInTheDocument()
  })
})
