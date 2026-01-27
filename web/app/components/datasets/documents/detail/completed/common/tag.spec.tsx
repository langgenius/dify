import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Tag from './tag'

describe('Tag', () => {
  // Rendering tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      const { container } = render(<Tag text="test" />)

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render the hash symbol', () => {
      // Arrange & Act
      render(<Tag text="test" />)

      // Assert
      expect(screen.getByText('#')).toBeInTheDocument()
    })

    it('should render the text content', () => {
      // Arrange & Act
      render(<Tag text="keyword" />)

      // Assert
      expect(screen.getByText('keyword')).toBeInTheDocument()
    })

    it('should render with correct base styling classes', () => {
      // Arrange & Act
      const { container } = render(<Tag text="test" />)

      // Assert
      const tagElement = container.firstChild as HTMLElement
      expect(tagElement).toHaveClass('inline-flex')
      expect(tagElement).toHaveClass('items-center')
      expect(tagElement).toHaveClass('gap-x-0.5')
    })
  })

  // Props tests
  describe('Props', () => {
    it('should apply custom className', () => {
      // Arrange & Act
      const { container } = render(<Tag text="test" className="custom-class" />)

      // Assert
      const tagElement = container.firstChild as HTMLElement
      expect(tagElement).toHaveClass('custom-class')
    })

    it('should render different text values', () => {
      // Arrange & Act
      const { rerender } = render(<Tag text="first" />)
      expect(screen.getByText('first')).toBeInTheDocument()

      // Act
      rerender(<Tag text="second" />)

      // Assert
      expect(screen.getByText('second')).toBeInTheDocument()
    })
  })

  // Structure tests
  describe('Structure', () => {
    it('should render hash with quaternary text color', () => {
      // Arrange & Act
      const { container } = render(<Tag text="test" />)

      // Assert
      const hashSpan = container.querySelector('.text-text-quaternary')
      expect(hashSpan).toBeInTheDocument()
      expect(hashSpan).toHaveTextContent('#')
    })

    it('should render text with tertiary text color', () => {
      // Arrange & Act
      const { container } = render(<Tag text="test" />)

      // Assert
      const textSpan = container.querySelector('.text-text-tertiary')
      expect(textSpan).toBeInTheDocument()
      expect(textSpan).toHaveTextContent('test')
    })

    it('should have truncate class for text overflow', () => {
      // Arrange & Act
      const { container } = render(<Tag text="very-long-text-that-might-overflow" />)

      // Assert
      const textSpan = container.querySelector('.truncate')
      expect(textSpan).toBeInTheDocument()
    })

    it('should have max-width constraint on text', () => {
      // Arrange & Act
      const { container } = render(<Tag text="test" />)

      // Assert
      const textSpan = container.querySelector('.max-w-12')
      expect(textSpan).toBeInTheDocument()
    })
  })

  // Memoization tests
  describe('Memoization', () => {
    it('should render consistently with same props', () => {
      // Arrange & Act
      const { container: container1 } = render(<Tag text="test" />)
      const { container: container2 } = render(<Tag text="test" />)

      // Assert
      expect(container1.firstChild?.textContent).toBe(container2.firstChild?.textContent)
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should handle empty text', () => {
      // Arrange & Act
      render(<Tag text="" />)

      // Assert - should still render the hash symbol
      expect(screen.getByText('#')).toBeInTheDocument()
    })

    it('should handle special characters in text', () => {
      // Arrange & Act
      render(<Tag text="test-tag_1" />)

      // Assert
      expect(screen.getByText('test-tag_1')).toBeInTheDocument()
    })

    it('should maintain structure when rerendered', () => {
      // Arrange
      const { rerender } = render(<Tag text="test" />)

      // Act
      rerender(<Tag text="test" />)

      // Assert
      expect(screen.getByText('#')).toBeInTheDocument()
      expect(screen.getByText('test')).toBeInTheDocument()
    })
  })
})
