import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Dot from '../dot'

describe('Dot', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<Dot />)

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render the dot character', () => {
      render(<Dot />)

      expect(screen.getByText('·')).toBeInTheDocument()
    })

    it('should render with correct styling classes', () => {
      const { container } = render(<Dot />)

      const dotElement = container.firstChild as HTMLElement
      expect(dotElement).toHaveClass('system-xs-medium')
      expect(dotElement).toHaveClass('text-text-quaternary')
    })
  })

  describe('Memoization', () => {
    it('should render consistently across multiple renders', () => {
      const { container: container1 } = render(<Dot />)
      const { container: container2 } = render(<Dot />)

      expect(container1.firstChild?.textContent).toBe(container2.firstChild?.textContent)
    })
  })

  describe('Edge Cases', () => {
    it('should maintain structure when rerendered', () => {
      const { rerender } = render(<Dot />)

      rerender(<Dot />)

      expect(screen.getByText('·')).toBeInTheDocument()
    })
  })
})
