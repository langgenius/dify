import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Empty from './empty'

describe('Empty', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      const { container } = render(<Empty onClearFilter={vi.fn()} />)

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render the file list icon', () => {
      // Arrange & Act
      const { container } = render(<Empty onClearFilter={vi.fn()} />)

      // Assert - RiFileList2Line icon should be rendered
      const icon = container.querySelector('.h-6.w-6')
      expect(icon).toBeInTheDocument()
    })

    it('should render empty message text', () => {
      // Arrange & Act
      render(<Empty onClearFilter={vi.fn()} />)

      // Assert - i18n key format: datasetDocuments:segment.empty
      expect(screen.getByText(/segment\.empty/i)).toBeInTheDocument()
    })

    it('should render clear filter button', () => {
      // Arrange & Act
      render(<Empty onClearFilter={vi.fn()} />)

      // Assert
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should render background empty cards', () => {
      // Arrange & Act
      const { container } = render(<Empty onClearFilter={vi.fn()} />)

      // Assert - should have 10 background cards
      const emptyCards = container.querySelectorAll('.bg-background-section-burn')
      expect(emptyCards).toHaveLength(10)
    })
  })

  // User Interactions
  describe('User Interactions', () => {
    it('should call onClearFilter when clear filter button is clicked', () => {
      // Arrange
      const mockOnClearFilter = vi.fn()
      render(<Empty onClearFilter={mockOnClearFilter} />)

      // Act
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(mockOnClearFilter).toHaveBeenCalledTimes(1)
    })
  })

  // Structure tests
  describe('Structure', () => {
    it('should render the decorative lines', () => {
      // Arrange & Act
      const { container } = render(<Empty onClearFilter={vi.fn()} />)

      // Assert - there should be 4 Line components (SVG elements)
      const svgElements = container.querySelectorAll('svg')
      expect(svgElements.length).toBeGreaterThanOrEqual(4)
    })

    it('should render mask overlay', () => {
      // Arrange & Act
      const { container } = render(<Empty onClearFilter={vi.fn()} />)

      // Assert
      const maskElement = container.querySelector('.bg-dataset-chunk-list-mask-bg')
      expect(maskElement).toBeInTheDocument()
    })

    it('should render icon container with proper styling', () => {
      // Arrange & Act
      const { container } = render(<Empty onClearFilter={vi.fn()} />)

      // Assert
      const iconContainer = container.querySelector('.shadow-lg')
      expect(iconContainer).toBeInTheDocument()
    })

    it('should render clear filter button with accent text styling', () => {
      // Arrange & Act
      render(<Empty onClearFilter={vi.fn()} />)

      // Assert
      const button = screen.getByRole('button')
      expect(button).toHaveClass('text-text-accent')
    })
  })

  // Props tests
  describe('Props', () => {
    it('should accept onClearFilter callback prop', () => {
      // Arrange
      const mockCallback = vi.fn()

      // Act
      render(<Empty onClearFilter={mockCallback} />)
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(mockCallback).toHaveBeenCalled()
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should handle multiple clicks on clear filter button', () => {
      // Arrange
      const mockOnClearFilter = vi.fn()
      render(<Empty onClearFilter={mockOnClearFilter} />)

      // Act
      const button = screen.getByRole('button')
      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.click(button)

      // Assert
      expect(mockOnClearFilter).toHaveBeenCalledTimes(3)
    })

    it('should maintain structure when rerendered', () => {
      // Arrange
      const { rerender, container } = render(<Empty onClearFilter={vi.fn()} />)

      // Act
      rerender(<Empty onClearFilter={vi.fn()} />)

      // Assert
      const emptyCards = container.querySelectorAll('.bg-background-section-burn')
      expect(emptyCards).toHaveLength(10)
    })
  })
})
