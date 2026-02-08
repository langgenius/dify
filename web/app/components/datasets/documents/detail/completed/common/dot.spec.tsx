import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Dot from './dot'

describe('Dot', () => {
  // Rendering tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      const { container } = render(<Dot />)

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render the dot character', () => {
      // Arrange & Act
      render(<Dot />)

      // Assert
      expect(screen.getByText('·')).toBeInTheDocument()
    })

    it('should render with correct styling classes', () => {
      // Arrange & Act
      const { container } = render(<Dot />)

      // Assert
      const dotElement = container.firstChild as HTMLElement
      expect(dotElement).toHaveClass('system-xs-medium')
      expect(dotElement).toHaveClass('text-text-quaternary')
    })
  })

  // Memoization tests
  describe('Memoization', () => {
    it('should render consistently across multiple renders', () => {
      // Arrange & Act
      const { container: container1 } = render(<Dot />)
      const { container: container2 } = render(<Dot />)

      // Assert
      expect(container1.firstChild?.textContent).toBe(container2.firstChild?.textContent)
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should maintain structure when rerendered', () => {
      // Arrange
      const { rerender } = render(<Dot />)

      // Act
      rerender(<Dot />)

      // Assert
      expect(screen.getByText('·')).toBeInTheDocument()
    })
  })
})
