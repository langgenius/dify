import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Score from '../score'

describe('Score', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests for the score display component
  describe('Rendering', () => {
    it('should render score value with toFixed(2)', () => {
      render(<Score value={0.85} />)

      expect(screen.getByText('0.85')).toBeInTheDocument()
      expect(screen.getByText('score')).toBeInTheDocument()
    })

    it('should render score progress bar with correct width', () => {
      const { container } = render(<Score value={0.75} />)

      const progressBar = container.querySelector('[style]')
      expect(progressBar).toHaveStyle({ width: '75%' })
    })

    it('should render with besideChunkName styling', () => {
      const { container } = render(<Score value={0.5} besideChunkName />)

      const root = container.firstElementChild
      expect(root?.className).toContain('h-[20.5px]')
      expect(root?.className).toContain('border-l-0')
    })

    it('should render with default styling when besideChunkName is false', () => {
      const { container } = render(<Score value={0.5} />)

      const root = container.firstElementChild
      expect(root?.className).toContain('h-[20px]')
      expect(root?.className).toContain('rounded-md')
    })

    it('should remove right border when value is exactly 1', () => {
      const { container } = render(<Score value={1} />)

      const progressBar = container.querySelector('[style]')
      expect(progressBar?.className).toContain('border-r-0')
      expect(progressBar).toHaveStyle({ width: '100%' })
    })

    it('should show right border when value is less than 1', () => {
      const { container } = render(<Score value={0.5} />)

      const progressBar = container.querySelector('[style]')
      expect(progressBar?.className).not.toContain('border-r-0')
    })
  })

  // Null return tests for edge cases
  describe('Returns null', () => {
    it('should return null when value is null', () => {
      const { container } = render(<Score value={null} />)

      expect(container.innerHTML).toBe('')
    })

    it('should return null when value is 0', () => {
      const { container } = render(<Score value={0} />)

      expect(container.innerHTML).toBe('')
    })

    it('should return null when value is NaN', () => {
      const { container } = render(<Score value={Number.NaN} />)

      expect(container.innerHTML).toBe('')
    })
  })

  describe('Edge Cases', () => {
    it('should render very small score values', () => {
      render(<Score value={0.01} />)

      expect(screen.getByText('0.01')).toBeInTheDocument()
    })

    it('should render score with many decimals truncated to 2', () => {
      render(<Score value={0.123456} />)

      expect(screen.getByText('0.12')).toBeInTheDocument()
    })
  })
})
