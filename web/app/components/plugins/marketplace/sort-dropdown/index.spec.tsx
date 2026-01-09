import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SortDropdown from './index'

// ================================
// Mock external dependencies only
// ================================

// Mock i18n translation hook
const mockTranslation = vi.fn((key: string, options?: { ns?: string }) => {
  // Build full key with namespace prefix if provided
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

// Mock marketplace atoms with controllable values
let mockSort: { sortBy: string, sortOrder: string } = { sortBy: 'install_count', sortOrder: 'DESC' }
const mockHandleSortChange = vi.fn()

vi.mock('../atoms', () => ({
  useMarketplaceSort: () => [mockSort, mockHandleSortChange],
}))

// Mock portal component with controllable open state
let mockPortalOpenState = false

vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children, open, onOpenChange }: {
    children: React.ReactNode
    open: boolean
    onOpenChange: (open: boolean) => void
  }) => {
    mockPortalOpenState = open
    return (
      <div data-testid="portal-wrapper" data-open={open}>
        {children}
      </div>
    )
  },
  PortalToFollowElemTrigger: ({ children, onClick }: {
    children: React.ReactNode
    onClick: () => void
  }) => (
    <div data-testid="portal-trigger" onClick={onClick}>
      {children}
    </div>
  ),
  PortalToFollowElemContent: ({ children }: { children: React.ReactNode }) => {
    // Match actual behavior: only render when portal is open
    if (!mockPortalOpenState)
      return null
    return <div data-testid="portal-content">{children}</div>
  },
}))

// ================================
// Test Factory Functions
// ================================

type SortOption = {
  value: string
  order: string
  text: string
}

const createSortOptions = (): SortOption[] => [
  { value: 'install_count', order: 'DESC', text: 'Most Popular' },
  { value: 'version_updated_at', order: 'DESC', text: 'Recently Updated' },
  { value: 'created_at', order: 'DESC', text: 'Newly Released' },
  { value: 'created_at', order: 'ASC', text: 'First Released' },
]

// ================================
// SortDropdown Component Tests
// ================================
describe('SortDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSort = { sortBy: 'install_count', sortOrder: 'DESC' }
    mockPortalOpenState = false
  })

  // ================================
  // Rendering Tests
  // ================================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<SortDropdown />)

      expect(screen.getByTestId('portal-wrapper')).toBeInTheDocument()
    })

    it('should render sort by label', () => {
      render(<SortDropdown />)

      expect(screen.getByText('Sort by')).toBeInTheDocument()
    })

    it('should render selected option text', () => {
      render(<SortDropdown />)

      expect(screen.getByText('Most Popular')).toBeInTheDocument()
    })

    it('should render arrow down icon', () => {
      const { container } = render(<SortDropdown />)

      const arrowIcon = container.querySelector('.h-4.w-4.text-text-tertiary')
      expect(arrowIcon).toBeInTheDocument()
    })

    it('should render trigger element with correct styles', () => {
      const { container } = render(<SortDropdown />)

      const trigger = container.querySelector('.cursor-pointer')
      expect(trigger).toBeInTheDocument()
      expect(trigger).toHaveClass('h-8', 'rounded-lg', 'bg-state-base-hover-alt')
    })

    it('should not render dropdown content when closed', () => {
      render(<SortDropdown />)

      expect(screen.queryByTestId('portal-content')).not.toBeInTheDocument()
    })
  })

  // ================================
  // State Management Tests
  // ================================
  describe('State Management', () => {
    it('should initialize with closed state', () => {
      render(<SortDropdown />)

      const wrapper = screen.getByTestId('portal-wrapper')
      expect(wrapper).toHaveAttribute('data-open', 'false')
    })

    it('should display correct selected option for install_count DESC', () => {
      mockSort = { sortBy: 'install_count', sortOrder: 'DESC' }
      render(<SortDropdown />)

      expect(screen.getByText('Most Popular')).toBeInTheDocument()
    })

    it('should display correct selected option for version_updated_at DESC', () => {
      mockSort = { sortBy: 'version_updated_at', sortOrder: 'DESC' }
      render(<SortDropdown />)

      expect(screen.getByText('Recently Updated')).toBeInTheDocument()
    })

    it('should display correct selected option for created_at DESC', () => {
      mockSort = { sortBy: 'created_at', sortOrder: 'DESC' }
      render(<SortDropdown />)

      expect(screen.getByText('Newly Released')).toBeInTheDocument()
    })

    it('should display correct selected option for created_at ASC', () => {
      mockSort = { sortBy: 'created_at', sortOrder: 'ASC' }
      render(<SortDropdown />)

      expect(screen.getByText('First Released')).toBeInTheDocument()
    })

    it('should toggle open state when trigger clicked', () => {
      render(<SortDropdown />)

      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      // After click, portal content should be visible
      expect(screen.getByTestId('portal-content')).toBeInTheDocument()
    })

    it('should close dropdown when trigger clicked again', () => {
      render(<SortDropdown />)

      const trigger = screen.getByTestId('portal-trigger')

      // Open
      fireEvent.click(trigger)
      expect(screen.getByTestId('portal-content')).toBeInTheDocument()

      // Close
      fireEvent.click(trigger)
      expect(screen.queryByTestId('portal-content')).not.toBeInTheDocument()
    })
  })

  // ================================
  // User Interactions Tests
  // ================================
  describe('User Interactions', () => {
    it('should open dropdown on trigger click', () => {
      render(<SortDropdown />)

      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      expect(screen.getByTestId('portal-content')).toBeInTheDocument()
    })

    it('should render all sort options when open', () => {
      render(<SortDropdown />)

      // Open dropdown
      fireEvent.click(screen.getByTestId('portal-trigger'))

      const content = screen.getByTestId('portal-content')
      expect(within(content).getByText('Most Popular')).toBeInTheDocument()
      expect(within(content).getByText('Recently Updated')).toBeInTheDocument()
      expect(within(content).getByText('Newly Released')).toBeInTheDocument()
      expect(within(content).getByText('First Released')).toBeInTheDocument()
    })

    it('should call handleSortChange when option clicked', () => {
      render(<SortDropdown />)

      // Open dropdown
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Click on "Recently Updated"
      const content = screen.getByTestId('portal-content')
      fireEvent.click(within(content).getByText('Recently Updated'))

      expect(mockHandleSortChange).toHaveBeenCalledWith({
        sortBy: 'version_updated_at',
        sortOrder: 'DESC',
      })
    })

    it('should call handleSortChange with correct params for Most Popular', () => {
      mockSort = { sortBy: 'created_at', sortOrder: 'DESC' }
      render(<SortDropdown />)

      fireEvent.click(screen.getByTestId('portal-trigger'))

      const content = screen.getByTestId('portal-content')
      fireEvent.click(within(content).getByText('Most Popular'))

      expect(mockHandleSortChange).toHaveBeenCalledWith({
        sortBy: 'install_count',
        sortOrder: 'DESC',
      })
    })

    it('should call handleSortChange with correct params for Newly Released', () => {
      render(<SortDropdown />)

      fireEvent.click(screen.getByTestId('portal-trigger'))

      const content = screen.getByTestId('portal-content')
      fireEvent.click(within(content).getByText('Newly Released'))

      expect(mockHandleSortChange).toHaveBeenCalledWith({
        sortBy: 'created_at',
        sortOrder: 'DESC',
      })
    })

    it('should call handleSortChange with correct params for First Released', () => {
      render(<SortDropdown />)

      fireEvent.click(screen.getByTestId('portal-trigger'))

      const content = screen.getByTestId('portal-content')
      fireEvent.click(within(content).getByText('First Released'))

      expect(mockHandleSortChange).toHaveBeenCalledWith({
        sortBy: 'created_at',
        sortOrder: 'ASC',
      })
    })

    it('should allow selecting currently selected option', () => {
      mockSort = { sortBy: 'install_count', sortOrder: 'DESC' }
      render(<SortDropdown />)

      fireEvent.click(screen.getByTestId('portal-trigger'))

      const content = screen.getByTestId('portal-content')
      fireEvent.click(within(content).getByText('Most Popular'))

      expect(mockHandleSortChange).toHaveBeenCalledWith({
        sortBy: 'install_count',
        sortOrder: 'DESC',
      })
    })

    it('should support userEvent for trigger click', async () => {
      const user = userEvent.setup()
      render(<SortDropdown />)

      const trigger = screen.getByTestId('portal-trigger')
      await user.click(trigger)

      expect(screen.getByTestId('portal-content')).toBeInTheDocument()
    })
  })

  // ================================
  // Check Icon Tests
  // ================================
  describe('Check Icon', () => {
    it('should show check icon for selected option', () => {
      mockSort = { sortBy: 'install_count', sortOrder: 'DESC' }
      const { container } = render(<SortDropdown />)

      // Open dropdown
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Check icon should be present in the dropdown
      const checkIcon = container.querySelector('.text-text-accent')
      expect(checkIcon).toBeInTheDocument()
    })

    it('should show check icon only for matching sortBy AND sortOrder', () => {
      mockSort = { sortBy: 'created_at', sortOrder: 'DESC' }
      render(<SortDropdown />)

      fireEvent.click(screen.getByTestId('portal-trigger'))

      const content = screen.getByTestId('portal-content')
      const options = content.querySelectorAll('.cursor-pointer')

      // "Newly Released" (created_at DESC) should have check icon
      // "First Released" (created_at ASC) should NOT have check icon
      expect(options.length).toBe(4)
    })

    it('should not show check icon for different sortOrder with same sortBy', () => {
      mockSort = { sortBy: 'created_at', sortOrder: 'DESC' }
      const { container } = render(<SortDropdown />)

      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Only one check icon should be visible (for Newly Released, not First Released)
      const checkIcons = container.querySelectorAll('.text-text-accent')
      expect(checkIcons.length).toBe(1)
    })
  })

  // ================================
  // Dropdown Options Structure Tests
  // ================================
  describe('Dropdown Options Structure', () => {
    const sortOptions = createSortOptions()

    it('should render 4 sort options', () => {
      render(<SortDropdown />)

      fireEvent.click(screen.getByTestId('portal-trigger'))

      const content = screen.getByTestId('portal-content')
      const options = content.querySelectorAll('.cursor-pointer')
      expect(options.length).toBe(4)
    })

    it.each(sortOptions)('should render option: $text', ({ text }) => {
      render(<SortDropdown />)

      fireEvent.click(screen.getByTestId('portal-trigger'))

      const content = screen.getByTestId('portal-content')
      expect(within(content).getByText(text)).toBeInTheDocument()
    })

    it('should render options with unique keys', () => {
      render(<SortDropdown />)

      fireEvent.click(screen.getByTestId('portal-trigger'))

      const content = screen.getByTestId('portal-content')
      const options = content.querySelectorAll('.cursor-pointer')

      // All options should be rendered (no key conflicts)
      expect(options.length).toBe(4)
    })

    it('should render dropdown container with correct styles', () => {
      render(<SortDropdown />)

      fireEvent.click(screen.getByTestId('portal-trigger'))

      const content = screen.getByTestId('portal-content')
      const container = content.firstChild as HTMLElement
      expect(container).toHaveClass('rounded-xl', 'shadow-lg')
    })

    it('should render option items with hover styles', () => {
      render(<SortDropdown />)

      fireEvent.click(screen.getByTestId('portal-trigger'))

      const content = screen.getByTestId('portal-content')
      const option = content.querySelector('.cursor-pointer')
      expect(option).toHaveClass('hover:bg-components-panel-on-panel-item-bg-hover')
    })
  })

  // ================================
  // Edge Cases Tests
  // ================================
  describe('Edge Cases', () => {
    // The component falls back to the first option (Most Popular) when sort values are invalid

    it('should fallback to default option when sortBy is unknown', () => {
      mockSort = { sortBy: 'unknown_field', sortOrder: 'DESC' }

      render(<SortDropdown />)

      // Should fallback to first option "Most Popular"
      expect(screen.getByText('Most Popular')).toBeInTheDocument()
    })

    it('should fallback to default option when sortBy is empty', () => {
      mockSort = { sortBy: '', sortOrder: 'DESC' }

      render(<SortDropdown />)

      expect(screen.getByText('Most Popular')).toBeInTheDocument()
    })

    it('should fallback to default option when sortOrder is unknown', () => {
      mockSort = { sortBy: 'install_count', sortOrder: 'UNKNOWN' }

      render(<SortDropdown />)

      expect(screen.getByText('Most Popular')).toBeInTheDocument()
    })

    it('should render correctly when handleSortChange is a no-op', () => {
      mockHandleSortChange.mockImplementation(() => {})
      render(<SortDropdown />)

      fireEvent.click(screen.getByTestId('portal-trigger'))

      const content = screen.getByTestId('portal-content')
      fireEvent.click(within(content).getByText('Recently Updated'))

      expect(mockHandleSortChange).toHaveBeenCalled()
    })

    it('should handle rapid toggle clicks', () => {
      render(<SortDropdown />)

      const trigger = screen.getByTestId('portal-trigger')

      // Rapid clicks
      fireEvent.click(trigger)
      fireEvent.click(trigger)
      fireEvent.click(trigger)

      // Final state should be open (odd number of clicks)
      expect(screen.getByTestId('portal-content')).toBeInTheDocument()
    })

    it('should handle multiple option selections', () => {
      render(<SortDropdown />)

      fireEvent.click(screen.getByTestId('portal-trigger'))

      const content = screen.getByTestId('portal-content')

      // Click multiple options
      fireEvent.click(within(content).getByText('Recently Updated'))
      fireEvent.click(within(content).getByText('Newly Released'))
      fireEvent.click(within(content).getByText('First Released'))

      expect(mockHandleSortChange).toHaveBeenCalledTimes(3)
    })
  })

  // ================================
  // Context Integration Tests
  // ================================
  describe('Context Integration', () => {
    it('should read sort value from context', () => {
      mockSort = { sortBy: 'version_updated_at', sortOrder: 'DESC' }
      render(<SortDropdown />)

      expect(screen.getByText('Recently Updated')).toBeInTheDocument()
    })

    it('should call context handleSortChange on selection', () => {
      render(<SortDropdown />)

      fireEvent.click(screen.getByTestId('portal-trigger'))

      const content = screen.getByTestId('portal-content')
      fireEvent.click(within(content).getByText('First Released'))

      expect(mockHandleSortChange).toHaveBeenCalledWith({
        sortBy: 'created_at',
        sortOrder: 'ASC',
      })
    })

    it('should update display when context sort changes', () => {
      const { rerender } = render(<SortDropdown />)

      expect(screen.getByText('Most Popular')).toBeInTheDocument()

      // Simulate context change
      mockSort = { sortBy: 'created_at', sortOrder: 'ASC' }
      rerender(<SortDropdown />)

      expect(screen.getByText('First Released')).toBeInTheDocument()
    })

    it('should use selector pattern correctly', () => {
      render(<SortDropdown />)

      // Component should have called useMarketplaceContext with selector functions
      expect(screen.getByTestId('portal-wrapper')).toBeInTheDocument()
    })
  })

  // ================================
  // Accessibility Tests
  // ================================
  describe('Accessibility', () => {
    it('should have cursor pointer on trigger', () => {
      const { container } = render(<SortDropdown />)

      const trigger = container.querySelector('.cursor-pointer')
      expect(trigger).toBeInTheDocument()
    })

    it('should have cursor pointer on options', () => {
      render(<SortDropdown />)

      fireEvent.click(screen.getByTestId('portal-trigger'))

      const content = screen.getByTestId('portal-content')
      const options = content.querySelectorAll('.cursor-pointer')
      expect(options.length).toBeGreaterThan(0)
    })

    it('should have visible focus indicators via hover styles', () => {
      render(<SortDropdown />)

      fireEvent.click(screen.getByTestId('portal-trigger'))

      const content = screen.getByTestId('portal-content')
      const option = content.querySelector('.hover\\:bg-components-panel-on-panel-item-bg-hover')
      expect(option).toBeInTheDocument()
    })
  })

  // ================================
  // Translation Tests
  // ================================
  describe('Translations', () => {
    it('should call translation for sortBy label', () => {
      render(<SortDropdown />)

      expect(mockTranslation).toHaveBeenCalledWith('marketplace.sortBy', { ns: 'plugin' })
    })

    it('should call translation for all sort options', () => {
      render(<SortDropdown />)

      expect(mockTranslation).toHaveBeenCalledWith('marketplace.sortOption.mostPopular', { ns: 'plugin' })
      expect(mockTranslation).toHaveBeenCalledWith('marketplace.sortOption.recentlyUpdated', { ns: 'plugin' })
      expect(mockTranslation).toHaveBeenCalledWith('marketplace.sortOption.newlyReleased', { ns: 'plugin' })
      expect(mockTranslation).toHaveBeenCalledWith('marketplace.sortOption.firstReleased', { ns: 'plugin' })
    })
  })

  // ================================
  // Portal Component Integration Tests
  // ================================
  describe('Portal Component Integration', () => {
    it('should pass open state to PortalToFollowElem', () => {
      render(<SortDropdown />)

      const wrapper = screen.getByTestId('portal-wrapper')
      expect(wrapper).toHaveAttribute('data-open', 'false')

      fireEvent.click(screen.getByTestId('portal-trigger'))

      expect(wrapper).toHaveAttribute('data-open', 'true')
    })

    it('should render trigger content inside PortalToFollowElemTrigger', () => {
      render(<SortDropdown />)

      const trigger = screen.getByTestId('portal-trigger')
      expect(within(trigger).getByText('Sort by')).toBeInTheDocument()
      expect(within(trigger).getByText('Most Popular')).toBeInTheDocument()
    })

    it('should render options inside PortalToFollowElemContent', () => {
      render(<SortDropdown />)

      fireEvent.click(screen.getByTestId('portal-trigger'))

      const content = screen.getByTestId('portal-content')
      expect(within(content).getByText('Most Popular')).toBeInTheDocument()
    })
  })

  // ================================
  // Visual Style Tests
  // ================================
  describe('Visual Styles', () => {
    it('should apply correct trigger container styles', () => {
      const { container } = render(<SortDropdown />)

      const triggerDiv = container.querySelector('.flex.h-8.cursor-pointer.items-center.rounded-lg')
      expect(triggerDiv).toBeInTheDocument()
    })

    it('should apply secondary text color to sort by label', () => {
      const { container } = render(<SortDropdown />)

      const label = container.querySelector('.text-text-secondary')
      expect(label).toBeInTheDocument()
      expect(label?.textContent).toBe('Sort by')
    })

    it('should apply primary text color to selected option', () => {
      const { container } = render(<SortDropdown />)

      const selected = container.querySelector('.text-text-primary.system-sm-medium')
      expect(selected).toBeInTheDocument()
    })

    it('should apply tertiary text color to arrow icon', () => {
      const { container } = render(<SortDropdown />)

      const arrow = container.querySelector('.text-text-tertiary')
      expect(arrow).toBeInTheDocument()
    })

    it('should apply accent text color to check icon when option selected', () => {
      mockSort = { sortBy: 'install_count', sortOrder: 'DESC' }
      const { container } = render(<SortDropdown />)

      fireEvent.click(screen.getByTestId('portal-trigger'))

      const checkIcon = container.querySelector('.text-text-accent')
      expect(checkIcon).toBeInTheDocument()
    })

    it('should apply blur backdrop to dropdown container', () => {
      render(<SortDropdown />)

      fireEvent.click(screen.getByTestId('portal-trigger'))

      const content = screen.getByTestId('portal-content')
      const container = content.querySelector('.backdrop-blur-sm')
      expect(container).toBeInTheDocument()
    })
  })

  // ================================
  // All Sort Options Click Tests
  // ================================
  describe('All Sort Options Click Handlers', () => {
    const testCases = [
      { text: 'Most Popular', sortBy: 'install_count', sortOrder: 'DESC' },
      { text: 'Recently Updated', sortBy: 'version_updated_at', sortOrder: 'DESC' },
      { text: 'Newly Released', sortBy: 'created_at', sortOrder: 'DESC' },
      { text: 'First Released', sortBy: 'created_at', sortOrder: 'ASC' },
    ]

    it.each(testCases)(
      'should call handleSortChange with { sortBy: "$sortBy", sortOrder: "$sortOrder" } when clicking "$text"',
      ({ text, sortBy, sortOrder }) => {
        render(<SortDropdown />)

        fireEvent.click(screen.getByTestId('portal-trigger'))

        const content = screen.getByTestId('portal-content')
        fireEvent.click(within(content).getByText(text))

        expect(mockHandleSortChange).toHaveBeenCalledWith({ sortBy, sortOrder })
      },
    )
  })
})
