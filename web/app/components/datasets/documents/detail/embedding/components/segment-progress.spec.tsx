import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import SegmentProgress from './segment-progress'

describe('SegmentProgress', () => {
  const defaultProps = {
    completedSegments: 50,
    totalSegments: 100,
    percent: 50,
  }

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<SegmentProgress {...defaultProps} />)
      expect(screen.getByText(/segments/i)).toBeInTheDocument()
    })

    it('should render with correct CSS classes', () => {
      const { container } = render(<SegmentProgress {...defaultProps} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('flex', 'w-full', 'items-center')
    })

    it('should render text with correct styling class', () => {
      render(<SegmentProgress {...defaultProps} />)
      const text = screen.getByText(/segments/i)
      expect(text).toHaveClass('system-xs-medium', 'text-text-secondary')
    })
  })

  describe('Progress Display', () => {
    it('should display completed and total segments', () => {
      render(<SegmentProgress completedSegments={50} totalSegments={100} percent={50} />)
      expect(screen.getByText(/50\/100/)).toBeInTheDocument()
    })

    it('should display percent value', () => {
      render(<SegmentProgress completedSegments={50} totalSegments={100} percent={50} />)
      expect(screen.getByText(/50%/)).toBeInTheDocument()
    })

    it('should display 0/0 when segments are 0', () => {
      render(<SegmentProgress completedSegments={0} totalSegments={0} percent={0} />)
      expect(screen.getByText(/0\/0/)).toBeInTheDocument()
      expect(screen.getByText(/0%/)).toBeInTheDocument()
    })

    it('should display 100% when completed', () => {
      render(<SegmentProgress completedSegments={100} totalSegments={100} percent={100} />)
      expect(screen.getByText(/100\/100/)).toBeInTheDocument()
      expect(screen.getByText(/100%/)).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should display -- when completedSegments is undefined', () => {
      render(<SegmentProgress totalSegments={100} percent={0} />)
      expect(screen.getByText(/--\/100/)).toBeInTheDocument()
    })

    it('should display -- when totalSegments is undefined', () => {
      render(<SegmentProgress completedSegments={50} percent={50} />)
      expect(screen.getByText(/50\/--/)).toBeInTheDocument()
    })

    it('should display --/-- when both segments are undefined', () => {
      render(<SegmentProgress percent={0} />)
      expect(screen.getByText(/--\/--/)).toBeInTheDocument()
    })

    it('should handle large numbers', () => {
      render(<SegmentProgress completedSegments={999999} totalSegments={1000000} percent={99} />)
      expect(screen.getByText(/999999\/1000000/)).toBeInTheDocument()
    })

    it('should handle decimal percent', () => {
      render(<SegmentProgress completedSegments={33} totalSegments={100} percent={33.33} />)
      expect(screen.getByText(/33.33%/)).toBeInTheDocument()
    })
  })
})
