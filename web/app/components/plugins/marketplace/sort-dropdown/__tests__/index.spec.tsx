import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
let mockCreationType = 'plugins'

vi.mock('../../atoms', () => ({
  useActiveSort: () => [mockSort, mockHandleSortChange],
  useCreationType: () => mockCreationType,
}))

vi.mock('../../search-params', () => ({
  CREATION_TYPE: { plugins: 'plugins', templates: 'templates' },
}))

let mockPortalOpenState = false

vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children, open }: { children: React.ReactNode, open: boolean }) => {
    mockPortalOpenState = open
    return <div data-testid="portal-wrapper" data-open={String(open)}>{children}</div>
  },
  PortalToFollowElemTrigger: ({ children, onClick }: { children: React.ReactNode, onClick: () => void }) => (
    <div data-testid="portal-trigger" onClick={onClick}>{children}</div>
  ),
  PortalToFollowElemContent: ({ children }: { children: React.ReactNode }) => {
    if (!mockPortalOpenState)
      return null
    return <div data-testid="portal-content">{children}</div>
  },
}))

describe('SortDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSort = { sortBy: 'install_count', sortOrder: 'DESC' }
    mockCreationType = 'plugins'
    mockPortalOpenState = false
  })

  describe('Rendering', () => {
    it('should render selected plugin sort label by default', () => {
      render(<SortDropdown />)

      expect(screen.getByText('Sort by')).toBeInTheDocument()
      expect(screen.getByText('Most Popular')).toBeInTheDocument()
      expect(screen.getByTestId('portal-wrapper')).toHaveAttribute('data-open', 'false')
    })

    it('should render template sort label when creationType is templates', () => {
      mockCreationType = 'templates'
      mockSort = { sortBy: 'updated_at', sortOrder: 'DESC' }

      render(<SortDropdown />)

      expect(screen.getByText('Recently Updated')).toBeInTheDocument()
    })
  })

  describe('Interactions', () => {
    it('should open the dropdown when trigger is clicked', () => {
      render(<SortDropdown />)

      fireEvent.click(screen.getByTestId('portal-trigger'))

      expect(screen.getByTestId('portal-content')).toBeInTheDocument()
      expect(within(screen.getByTestId('portal-content')).getByText('Recently Updated')).toBeInTheDocument()
    })

    it('should call handleSortChange with plugin sort option values', () => {
      render(<SortDropdown />)

      fireEvent.click(screen.getByTestId('portal-trigger'))
      fireEvent.click(within(screen.getByTestId('portal-content')).getByText('Recently Updated'))

      expect(mockHandleSortChange).toHaveBeenCalledWith({
        sortBy: 'version_updated_at',
        sortOrder: 'DESC',
      })
    })

    it('should call handleSortChange with template sort option values', () => {
      mockCreationType = 'templates'

      render(<SortDropdown />)

      fireEvent.click(screen.getByTestId('portal-trigger'))
      fireEvent.click(within(screen.getByTestId('portal-content')).getByText('Most Popular'))

      expect(mockHandleSortChange).toHaveBeenCalledWith({
        sortBy: 'usage_count',
        sortOrder: 'DESC',
      })
    })
  })

  describe('Selection', () => {
    it('should fall back to the first option when the sort does not match any option', () => {
      mockSort = { sortBy: 'unknown', sortOrder: 'DESC' }

      render(<SortDropdown />)

      expect(screen.getByText('Most Popular')).toBeInTheDocument()
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

    it('should apply blur-sm backdrop to dropdown container', () => {
      render(<SortDropdown />)

      fireEvent.click(screen.getByTestId('portal-trigger'))

      const content = screen.getByTestId('portal-content')
      const container = content.querySelector('.backdrop-blur-xs')
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
