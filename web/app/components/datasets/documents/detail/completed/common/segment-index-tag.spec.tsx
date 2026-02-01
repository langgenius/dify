import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import SegmentIndexTag from './segment-index-tag'

describe('SegmentIndexTag', () => {
  // Rendering tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      const { container } = render(<SegmentIndexTag positionId={1} />)

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render the Chunk icon', () => {
      // Arrange & Act
      const { container } = render(<SegmentIndexTag positionId={1} />)

      // Assert
      const icon = container.querySelector('.h-3.w-3')
      expect(icon).toBeInTheDocument()
    })

    it('should render with correct container classes', () => {
      // Arrange & Act
      const { container } = render(<SegmentIndexTag positionId={1} />)

      // Assert
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('flex')
      expect(wrapper).toHaveClass('items-center')
    })
  })

  // Props tests
  describe('Props', () => {
    it('should render position ID with default prefix', () => {
      // Arrange & Act
      render(<SegmentIndexTag positionId={5} />)

      // Assert - default prefix is 'Chunk'
      expect(screen.getByText('Chunk-05')).toBeInTheDocument()
    })

    it('should render position ID without padding for two-digit numbers', () => {
      // Arrange & Act
      render(<SegmentIndexTag positionId={15} />)

      // Assert
      expect(screen.getByText('Chunk-15')).toBeInTheDocument()
    })

    it('should render position ID without padding for three-digit numbers', () => {
      // Arrange & Act
      render(<SegmentIndexTag positionId={123} />)

      // Assert
      expect(screen.getByText('Chunk-123')).toBeInTheDocument()
    })

    it('should render custom label when provided', () => {
      // Arrange & Act
      render(<SegmentIndexTag positionId={1} label="Custom Label" />)

      // Assert
      expect(screen.getByText('Custom Label')).toBeInTheDocument()
    })

    it('should use custom labelPrefix', () => {
      // Arrange & Act
      render(<SegmentIndexTag positionId={3} labelPrefix="Segment" />)

      // Assert
      expect(screen.getByText('Segment-03')).toBeInTheDocument()
    })

    it('should apply custom className', () => {
      // Arrange & Act
      const { container } = render(
        <SegmentIndexTag positionId={1} className="custom-class" />,
      )

      // Assert
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('custom-class')
    })

    it('should apply custom iconClassName', () => {
      // Arrange & Act
      const { container } = render(
        <SegmentIndexTag positionId={1} iconClassName="custom-icon-class" />,
      )

      // Assert
      const icon = container.querySelector('.custom-icon-class')
      expect(icon).toBeInTheDocument()
    })

    it('should apply custom labelClassName', () => {
      // Arrange & Act
      const { container } = render(
        <SegmentIndexTag positionId={1} labelClassName="custom-label-class" />,
      )

      // Assert
      const label = container.querySelector('.custom-label-class')
      expect(label).toBeInTheDocument()
    })

    it('should handle string positionId', () => {
      // Arrange & Act
      render(<SegmentIndexTag positionId="7" />)

      // Assert
      expect(screen.getByText('Chunk-07')).toBeInTheDocument()
    })
  })

  // Memoization tests
  describe('Memoization', () => {
    it('should compute localPositionId based on positionId and labelPrefix', () => {
      // Arrange & Act
      const { rerender } = render(<SegmentIndexTag positionId={1} />)
      expect(screen.getByText('Chunk-01')).toBeInTheDocument()

      // Act - change positionId
      rerender(<SegmentIndexTag positionId={2} />)

      // Assert
      expect(screen.getByText('Chunk-02')).toBeInTheDocument()
    })

    it('should update when labelPrefix changes', () => {
      // Arrange & Act
      const { rerender } = render(<SegmentIndexTag positionId={1} labelPrefix="Chunk" />)
      expect(screen.getByText('Chunk-01')).toBeInTheDocument()

      // Act - change labelPrefix
      rerender(<SegmentIndexTag positionId={1} labelPrefix="Part" />)

      // Assert
      expect(screen.getByText('Part-01')).toBeInTheDocument()
    })
  })

  // Structure tests
  describe('Structure', () => {
    it('should render icon with tertiary text color', () => {
      // Arrange & Act
      const { container } = render(<SegmentIndexTag positionId={1} />)

      // Assert
      const icon = container.querySelector('.text-text-tertiary')
      expect(icon).toBeInTheDocument()
    })

    it('should render label with xs medium font styling', () => {
      // Arrange & Act
      const { container } = render(<SegmentIndexTag positionId={1} />)

      // Assert
      const label = container.querySelector('.system-xs-medium')
      expect(label).toBeInTheDocument()
    })

    it('should render icon with margin-right spacing', () => {
      // Arrange & Act
      const { container } = render(<SegmentIndexTag positionId={1} />)

      // Assert
      const icon = container.querySelector('.mr-0\\.5')
      expect(icon).toBeInTheDocument()
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should handle positionId of 0', () => {
      // Arrange & Act
      render(<SegmentIndexTag positionId={0} />)

      // Assert
      expect(screen.getByText('Chunk-00')).toBeInTheDocument()
    })

    it('should handle undefined positionId', () => {
      // Arrange & Act
      render(<SegmentIndexTag />)

      // Assert - should display 'Chunk-undefined' or similar
      expect(screen.getByText(/Chunk-/)).toBeInTheDocument()
    })

    it('should prioritize label over computed positionId', () => {
      // Arrange & Act
      render(<SegmentIndexTag positionId={99} label="Override" />)

      // Assert
      expect(screen.getByText('Override')).toBeInTheDocument()
      expect(screen.queryByText('Chunk-99')).not.toBeInTheDocument()
    })

    it('should maintain structure when rerendered', () => {
      // Arrange
      const { rerender, container } = render(<SegmentIndexTag positionId={1} />)

      // Act
      rerender(<SegmentIndexTag positionId={1} />)

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })
  })
})
