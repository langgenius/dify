import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import FullDocListSkeleton from './full-doc-list-skeleton'

describe('FullDocListSkeleton', () => {
  // Rendering tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      const { container } = render(<FullDocListSkeleton />)

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render the correct number of slice elements', () => {
      // Arrange & Act
      const { container } = render(<FullDocListSkeleton />)

      // Assert - component renders 15 slices
      const sliceElements = container.querySelectorAll('.flex.flex-col.gap-y-1')
      expect(sliceElements).toHaveLength(15)
    })

    it('should render mask overlay element', () => {
      // Arrange & Act
      const { container } = render(<FullDocListSkeleton />)

      // Assert - check for the mask overlay element
      const maskElement = container.querySelector('.bg-dataset-chunk-list-mask-bg')
      expect(maskElement).toBeInTheDocument()
    })

    it('should render with correct container classes', () => {
      // Arrange & Act
      const { container } = render(<FullDocListSkeleton />)

      // Assert
      const containerElement = container.firstChild as HTMLElement
      expect(containerElement).toHaveClass('relative')
      expect(containerElement).toHaveClass('z-10')
      expect(containerElement).toHaveClass('flex')
      expect(containerElement).toHaveClass('w-full')
      expect(containerElement).toHaveClass('grow')
      expect(containerElement).toHaveClass('flex-col')
      expect(containerElement).toHaveClass('gap-y-3')
      expect(containerElement).toHaveClass('overflow-y-hidden')
    })
  })

  // Structure tests
  describe('Structure', () => {
    it('should render slice elements with proper structure', () => {
      // Arrange & Act
      const { container } = render(<FullDocListSkeleton />)

      // Assert - each slice should have the content placeholder elements
      const slices = container.querySelectorAll('.flex.flex-col.gap-y-1')
      slices.forEach((slice) => {
        // Each slice should have children for the skeleton content
        expect(slice.children.length).toBeGreaterThan(0)
      })
    })

    it('should render slice with width placeholder elements', () => {
      // Arrange & Act
      const { container } = render(<FullDocListSkeleton />)

      // Assert - check for skeleton content width class
      const widthElements = container.querySelectorAll('.w-2\\/3')
      expect(widthElements.length).toBeGreaterThan(0)
    })

    it('should render slice elements with background classes', () => {
      // Arrange & Act
      const { container } = render(<FullDocListSkeleton />)

      // Assert - check for skeleton background classes
      const bgElements = container.querySelectorAll('.bg-state-base-hover')
      expect(bgElements.length).toBeGreaterThan(0)
    })
  })

  // Memoization tests
  describe('Memoization', () => {
    it('should render consistently across multiple renders', () => {
      // Arrange & Act
      const { container: container1 } = render(<FullDocListSkeleton />)
      const { container: container2 } = render(<FullDocListSkeleton />)

      // Assert - structure should be identical
      const slices1 = container1.querySelectorAll('.flex.flex-col.gap-y-1')
      const slices2 = container2.querySelectorAll('.flex.flex-col.gap-y-1')
      expect(slices1.length).toBe(slices2.length)
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should maintain structure when rendered multiple times', () => {
      // Arrange
      const { rerender, container } = render(<FullDocListSkeleton />)

      // Act
      rerender(<FullDocListSkeleton />)
      rerender(<FullDocListSkeleton />)

      // Assert
      const sliceElements = container.querySelectorAll('.flex.flex-col.gap-y-1')
      expect(sliceElements).toHaveLength(15)
    })

    it('should not have accessibility issues with skeleton content', () => {
      // Arrange & Act
      const { container } = render(<FullDocListSkeleton />)

      // Assert - skeleton should be purely visual, no interactive elements
      const buttons = container.querySelectorAll('button')
      const links = container.querySelectorAll('a')
      expect(buttons).toHaveLength(0)
      expect(links).toHaveLength(0)
    })
  })
})
