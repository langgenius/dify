import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ToolsNav from './index'

// Mock next/navigation
const mockUseSelectedLayoutSegment = vi.fn()
vi.mock('next/navigation', () => ({
  useSelectedLayoutSegment: () => mockUseSelectedLayoutSegment(),
}))

// Mock icons to verify which one is rendered
vi.mock('@remixicon/react', () => ({
  RiHammerFill: (props: React.ComponentProps<'svg'>) => (
    <svg data-testid="icon-hammer-fill" {...props} />
  ),
  RiHammerLine: (props: React.ComponentProps<'svg'>) => (
    <svg data-testid="icon-hammer-line" {...props} />
  ),
}))

describe('ToolsNav', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render standard inactive state correctly', () => {
      // Arrange
      mockUseSelectedLayoutSegment.mockReturnValue(null)

      // Act
      render(<ToolsNav />)

      const link = screen.getByRole('link')

      // Assert
      // 1. Check href
      expect(link).toHaveAttribute('href', '/tools')

      // 2. Check content (with namespace prefix as per global mock)
      expect(screen.getByText('common.menus.tools')).toBeInTheDocument()

      // 3. Check icon (should be Line version when inactive)
      expect(screen.getByTestId('icon-hammer-line')).toBeInTheDocument()
      expect(screen.queryByTestId('icon-hammer-fill')).not.toBeInTheDocument()

      // 4. Check classes for inactive state
      expect(link).not.toHaveClass(
        'bg-components-main-nav-nav-button-bg-active',
      )
      expect(link).toHaveClass('text-components-main-nav-nav-button-text')
      expect(link).toHaveClass(
        'hover:bg-components-main-nav-nav-button-bg-hover',
      )
    })

    it('should render active state correctly', () => {
      // Arrange
      mockUseSelectedLayoutSegment.mockReturnValue('tools')

      // Act
      render(<ToolsNav />)

      const link = screen.getByRole('link')

      // Assert
      // 1. Check classes for active state
      expect(link).toHaveClass('bg-components-main-nav-nav-button-bg-active')
      expect(link).toHaveClass(
        'text-components-main-nav-nav-button-text-active',
      )
      expect(link).toHaveClass('font-semibold')
      expect(link).toHaveClass('shadow-md')

      // 2. Check icon (should be Fill version when active)
      expect(screen.getByTestId('icon-hammer-fill')).toBeInTheDocument()
      expect(screen.queryByTestId('icon-hammer-line')).not.toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should merge additional classNames', () => {
      mockUseSelectedLayoutSegment.mockReturnValue(null)
      render(<ToolsNav className="custom-test-class" />)

      const link = screen.getByRole('link')
      expect(link).toHaveClass('custom-test-class')
    })
  })
})
