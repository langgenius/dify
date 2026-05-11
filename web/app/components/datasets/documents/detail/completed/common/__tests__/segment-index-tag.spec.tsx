import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import SegmentIndexTag from '../segment-index-tag'

describe('SegmentIndexTag', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<SegmentIndexTag positionId={1} />)

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render the Chunk icon', () => {
      const { container } = render(<SegmentIndexTag positionId={1} />)

      const icon = container.querySelector('.h-3.w-3')
      expect(icon).toBeInTheDocument()
    })

    it('should render with correct container classes', () => {
      const { container } = render(<SegmentIndexTag positionId={1} />)

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('flex')
      expect(wrapper).toHaveClass('items-center')
    })
  })

  describe('Props', () => {
    it('should render position ID with default prefix', () => {
      render(<SegmentIndexTag positionId={5} />)

      // Assert - default prefix is 'Chunk'
      expect(screen.getByText('Chunk-05')).toBeInTheDocument()
    })

    it('should render position ID without padding for two-digit numbers', () => {
      render(<SegmentIndexTag positionId={15} />)

      expect(screen.getByText('Chunk-15')).toBeInTheDocument()
    })

    it('should render position ID without padding for three-digit numbers', () => {
      render(<SegmentIndexTag positionId={123} />)

      expect(screen.getByText('Chunk-123')).toBeInTheDocument()
    })

    it('should render custom label when provided', () => {
      render(<SegmentIndexTag positionId={1} label="Custom Label" />)

      expect(screen.getByText('Custom Label')).toBeInTheDocument()
    })

    it('should use custom labelPrefix', () => {
      render(<SegmentIndexTag positionId={3} labelPrefix="Segment" />)

      expect(screen.getByText('Segment-03')).toBeInTheDocument()
    })

    it('should apply custom className', () => {
      const { container } = render(
        <SegmentIndexTag positionId={1} className="custom-class" />,
      )

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('custom-class')
    })

    it('should apply custom iconClassName', () => {
      const { container } = render(
        <SegmentIndexTag positionId={1} iconClassName="custom-icon-class" />,
      )

      const icon = container.querySelector('.custom-icon-class')
      expect(icon).toBeInTheDocument()
    })

    it('should apply custom labelClassName', () => {
      const { container } = render(
        <SegmentIndexTag positionId={1} labelClassName="custom-label-class" />,
      )

      const label = container.querySelector('.custom-label-class')
      expect(label).toBeInTheDocument()
    })

    it('should handle string positionId', () => {
      render(<SegmentIndexTag positionId="7" />)

      expect(screen.getByText('Chunk-07')).toBeInTheDocument()
    })
  })

  describe('Memoization', () => {
    it('should compute localPositionId based on positionId and labelPrefix', () => {
      const { rerender } = render(<SegmentIndexTag positionId={1} />)
      expect(screen.getByText('Chunk-01')).toBeInTheDocument()

      // Act - change positionId
      rerender(<SegmentIndexTag positionId={2} />)

      expect(screen.getByText('Chunk-02')).toBeInTheDocument()
    })

    it('should update when labelPrefix changes', () => {
      const { rerender } = render(<SegmentIndexTag positionId={1} labelPrefix="Chunk" />)
      expect(screen.getByText('Chunk-01')).toBeInTheDocument()

      // Act - change labelPrefix
      rerender(<SegmentIndexTag positionId={1} labelPrefix="Part" />)

      expect(screen.getByText('Part-01')).toBeInTheDocument()
    })
  })

  describe('Structure', () => {
    it('should render icon with tertiary text color', () => {
      const { container } = render(<SegmentIndexTag positionId={1} />)

      const icon = container.querySelector('.text-text-tertiary')
      expect(icon).toBeInTheDocument()
    })

    it('should render label with xs medium font styling', () => {
      const { container } = render(<SegmentIndexTag positionId={1} />)

      const label = container.querySelector('.system-xs-medium')
      expect(label).toBeInTheDocument()
    })

    it('should render icon with margin-right spacing', () => {
      const { container } = render(<SegmentIndexTag positionId={1} />)

      const icon = container.querySelector('.mr-0\\.5')
      expect(icon).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle positionId of 0', () => {
      render(<SegmentIndexTag positionId={0} />)

      expect(screen.getByText('Chunk-00')).toBeInTheDocument()
    })

    it('should handle undefined positionId', () => {
      render(<SegmentIndexTag />)

      // Assert - should display 'Chunk-undefined' or similar
      expect(screen.getByText(/Chunk-/)).toBeInTheDocument()
    })

    it('should prioritize label over computed positionId', () => {
      render(<SegmentIndexTag positionId={99} label="Override" />)

      expect(screen.getByText('Override')).toBeInTheDocument()
      expect(screen.queryByText('Chunk-99')).not.toBeInTheDocument()
    })

    it('should maintain structure when rerendered', () => {
      const { rerender, container } = render(<SegmentIndexTag positionId={1} />)

      rerender(<SegmentIndexTag positionId={1} />)

      expect(container.firstChild).toBeInTheDocument()
    })
  })
})
