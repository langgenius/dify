import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import More from './more'

describe('More', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<More count={5} />)
      expect(screen.getByText('+5')).toBeInTheDocument()
    })

    it('should display count with plus sign', () => {
      render(<More count={10} />)
      expect(screen.getByText('+10')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should format count as-is when less than 1000', () => {
      render(<More count={999} />)
      expect(screen.getByText('+999')).toBeInTheDocument()
    })

    it('should format count with k suffix when 1000 or more', () => {
      render(<More count={1500} />)
      expect(screen.getByText('+1.5k')).toBeInTheDocument()
    })

    it('should format count with M suffix when 1000000 or more', () => {
      render(<More count={2500000} />)
      expect(screen.getByText('+2.5M')).toBeInTheDocument()
    })

    it('should format 1000 as 1.0k', () => {
      render(<More count={1000} />)
      expect(screen.getByText('+1.0k')).toBeInTheDocument()
    })

    it('should format 1000000 as 1.0M', () => {
      render(<More count={1000000} />)
      expect(screen.getByText('+1.0M')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onClick when clicked', () => {
      const onClick = vi.fn()
      render(<More count={5} onClick={onClick} />)

      fireEvent.click(screen.getByText('+5'))
      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('should not throw when clicked without onClick', () => {
      render(<More count={5} />)

      // Should not throw
      expect(() => {
        fireEvent.click(screen.getByText('+5'))
      }).not.toThrow()
    })

    it('should stop event propagation on click', () => {
      const parentClick = vi.fn()
      const childClick = vi.fn()

      render(
        <div onClick={parentClick}>
          <More count={5} onClick={childClick} />
        </div>,
      )

      fireEvent.click(screen.getByText('+5'))
      expect(childClick).toHaveBeenCalled()
      expect(parentClick).not.toHaveBeenCalled()
    })
  })

  describe('Edge Cases', () => {
    it('should display +0 when count is 0', () => {
      render(<More count={0} />)
      expect(screen.getByText('+0')).toBeInTheDocument()
    })

    it('should handle count of 1', () => {
      render(<More count={1} />)
      expect(screen.getByText('+1')).toBeInTheDocument()
    })

    it('should handle boundary value 999', () => {
      render(<More count={999} />)
      expect(screen.getByText('+999')).toBeInTheDocument()
    })

    it('should handle boundary value 999999', () => {
      render(<More count={999999} />)
      // 999999 / 1000 = 999.999 -> 1000.0k
      expect(screen.getByText('+1000.0k')).toBeInTheDocument()
    })

    it('should apply cursor-pointer class', () => {
      const { container } = render(<More count={5} />)
      expect(container.firstChild).toHaveClass('cursor-pointer')
    })
  })

  describe('formatNumber branches', () => {
    it('should return "0" when num equals 0', () => {
      // This covers line 11-12: if (num === 0) return '0'
      render(<More count={0} />)
      expect(screen.getByText('+0')).toBeInTheDocument()
    })

    it('should return num.toString() when num < 1000 and num > 0', () => {
      // This covers line 13-14: if (num < 1000) return num.toString()
      render(<More count={500} />)
      expect(screen.getByText('+500')).toBeInTheDocument()
    })

    it('should return k format when 1000 <= num < 1000000', () => {
      // This covers line 15-16
      const { rerender } = render(<More count={5000} />)
      expect(screen.getByText('+5.0k')).toBeInTheDocument()

      rerender(<More count={999999} />)
      expect(screen.getByText('+1000.0k')).toBeInTheDocument()

      rerender(<More count={50000} />)
      expect(screen.getByText('+50.0k')).toBeInTheDocument()
    })

    it('should return M format when num >= 1000000', () => {
      // This covers line 17
      const { rerender } = render(<More count={1000000} />)
      expect(screen.getByText('+1.0M')).toBeInTheDocument()

      rerender(<More count={5000000} />)
      expect(screen.getByText('+5.0M')).toBeInTheDocument()

      rerender(<More count={999999999} />)
      expect(screen.getByText('+1000.0M')).toBeInTheDocument()
    })
  })
})
