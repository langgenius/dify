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
})
