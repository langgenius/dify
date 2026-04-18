import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Tag from '../tag'

describe('Tag', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<Tag text="test" />)

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render the hash symbol', () => {
      render(<Tag text="test" />)

      expect(screen.getByText('#')).toBeInTheDocument()
    })

    it('should render the text content', () => {
      render(<Tag text="keyword" />)

      expect(screen.getByText('keyword')).toBeInTheDocument()
    })

    it('should render with correct base styling classes', () => {
      const { container } = render(<Tag text="test" />)

      const tagElement = container.firstChild as HTMLElement
      expect(tagElement).toHaveClass('inline-flex')
      expect(tagElement).toHaveClass('items-center')
      expect(tagElement).toHaveClass('gap-x-0.5')
    })
  })

  describe('Props', () => {
    it('should apply custom className', () => {
      const { container } = render(<Tag text="test" className="custom-class" />)

      const tagElement = container.firstChild as HTMLElement
      expect(tagElement).toHaveClass('custom-class')
    })

    it('should render different text values', () => {
      const { rerender } = render(<Tag text="first" />)
      expect(screen.getByText('first')).toBeInTheDocument()

      rerender(<Tag text="second" />)

      expect(screen.getByText('second')).toBeInTheDocument()
    })
  })

  describe('Structure', () => {
    it('should render hash with quaternary text color', () => {
      const { container } = render(<Tag text="test" />)

      const hashSpan = container.querySelector('.text-text-quaternary')
      expect(hashSpan).toBeInTheDocument()
      expect(hashSpan).toHaveTextContent('#')
    })

    it('should render text with tertiary text color', () => {
      const { container } = render(<Tag text="test" />)

      const textSpan = container.querySelector('.text-text-tertiary')
      expect(textSpan).toBeInTheDocument()
      expect(textSpan).toHaveTextContent('test')
    })

    it('should have truncate class for text overflow', () => {
      const { container } = render(<Tag text="very-long-text-that-might-overflow" />)

      const textSpan = container.querySelector('.truncate')
      expect(textSpan).toBeInTheDocument()
    })

    it('should have max-width constraint on text', () => {
      const { container } = render(<Tag text="test" />)

      const textSpan = container.querySelector('.max-w-12')
      expect(textSpan).toBeInTheDocument()
    })
  })

  describe('Memoization', () => {
    it('should render consistently with same props', () => {
      const { container: container1 } = render(<Tag text="test" />)
      const { container: container2 } = render(<Tag text="test" />)

      expect(container1.firstChild?.textContent).toBe(container2.firstChild?.textContent)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty text', () => {
      render(<Tag text="" />)

      // Assert - should still render the hash symbol
      expect(screen.getByText('#')).toBeInTheDocument()
    })

    it('should handle special characters in text', () => {
      render(<Tag text="test-tag_1" />)

      expect(screen.getByText('test-tag_1')).toBeInTheDocument()
    })

    it('should maintain structure when rerendered', () => {
      const { rerender } = render(<Tag text="test" />)

      rerender(<Tag text="test" />)

      expect(screen.getByText('#')).toBeInTheDocument()
      expect(screen.getByText('test')).toBeInTheDocument()
    })
  })
})
