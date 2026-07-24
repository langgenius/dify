import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Empty from '../empty'

describe('Empty', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<Empty onClearFilter={vi.fn()} />)

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render the file list icon', () => {
      const { container } = render(<Empty onClearFilter={vi.fn()} />)

      // Assert - RiFileList2Line icon should be rendered
      const icon = container.querySelector('.h-6.w-6')
      expect(icon).toBeInTheDocument()
    })

    it('should render empty message text', () => {
      render(<Empty onClearFilter={vi.fn()} />)

      // Assert - i18n key format: datasetDocuments:segment.empty
      expect(screen.getByText(/segment\.empty/i)).toBeInTheDocument()
    })

    it('should render clear filter button', () => {
      render(<Empty onClearFilter={vi.fn()} />)

      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should render background empty cards', () => {
      const { container } = render(<Empty onClearFilter={vi.fn()} />)

      // Assert - should have 10 background cards
      const emptyCards = container.querySelectorAll('.bg-background-section-burn')
      expect(emptyCards).toHaveLength(10)
    })
  })

  describe('User Interactions', () => {
    it('should call onClearFilter when clear filter button is clicked', () => {
      const mockOnClearFilter = vi.fn()
      render(<Empty onClearFilter={mockOnClearFilter} />)

      fireEvent.click(screen.getByRole('button'))

      expect(mockOnClearFilter).toHaveBeenCalledTimes(1)
    })
  })

  describe('Structure', () => {
    it('should render the decorative lines', () => {
      const { container } = render(<Empty onClearFilter={vi.fn()} />)

      // Assert - there should be 4 Line components (SVG elements)
      const svgElements = container.querySelectorAll('svg')
      expect(svgElements.length).toBeGreaterThanOrEqual(4)
    })

    it('should render mask overlay', () => {
      const { container } = render(<Empty onClearFilter={vi.fn()} />)

      const maskElement = container.querySelector('.bg-dataset-chunk-list-mask-bg')
      expect(maskElement).toBeInTheDocument()
    })

    it('should render icon container with proper styling', () => {
      const { container } = render(<Empty onClearFilter={vi.fn()} />)

      const iconContainer = container.querySelector('.shadow-lg')
      expect(iconContainer).toBeInTheDocument()
    })

    it('should render clear filter button with accent text styling', () => {
      render(<Empty onClearFilter={vi.fn()} />)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('text-text-accent')
    })
  })

  describe('Props', () => {
    it('should accept onClearFilter callback prop', () => {
      const mockCallback = vi.fn()

      render(<Empty onClearFilter={mockCallback} />)
      fireEvent.click(screen.getByRole('button'))

      expect(mockCallback).toHaveBeenCalled()
    })
  })

  describe('Edge Cases', () => {
    it('should handle multiple clicks on clear filter button', () => {
      const mockOnClearFilter = vi.fn()
      render(<Empty onClearFilter={mockOnClearFilter} />)

      const button = screen.getByRole('button')
      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.click(button)

      expect(mockOnClearFilter).toHaveBeenCalledTimes(3)
    })

    it('should maintain structure when rerendered', () => {
      const { rerender, container } = render(<Empty onClearFilter={vi.fn()} />)

      rerender(<Empty onClearFilter={vi.fn()} />)

      const emptyCards = container.querySelectorAll('.bg-background-section-burn')
      expect(emptyCards).toHaveLength(10)
    })
  })
})
