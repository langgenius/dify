import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ParagraphListSkeleton from './paragraph-list-skeleton'

describe('ParagraphListSkeleton', () => {
  // Rendering tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      const { container } = render(<ParagraphListSkeleton />)

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render the correct number of list items', () => {
      // Arrange & Act
      const { container } = render(<ParagraphListSkeleton />)

      // Assert - component renders 10 items
      const listItems = container.querySelectorAll('.items-start.gap-x-2')
      expect(listItems).toHaveLength(10)
    })

    it('should render mask overlay element', () => {
      // Arrange & Act
      const { container } = render(<ParagraphListSkeleton />)

      // Assert
      const maskElement = container.querySelector('.bg-dataset-chunk-list-mask-bg')
      expect(maskElement).toBeInTheDocument()
    })

    it('should render with correct container classes', () => {
      // Arrange & Act
      const { container } = render(<ParagraphListSkeleton />)

      // Assert
      const containerElement = container.firstChild as HTMLElement
      expect(containerElement).toHaveClass('relative')
      expect(containerElement).toHaveClass('z-10')
      expect(containerElement).toHaveClass('flex')
      expect(containerElement).toHaveClass('h-full')
      expect(containerElement).toHaveClass('flex-col')
      expect(containerElement).toHaveClass('overflow-y-hidden')
    })
  })

  // Checkbox tests
  describe('Checkboxes', () => {
    it('should render disabled checkboxes', () => {
      // Arrange & Act
      const { container } = render(<ParagraphListSkeleton />)

      // Assert - Checkbox component uses cursor-not-allowed class when disabled
      const disabledCheckboxes = container.querySelectorAll('.cursor-not-allowed')
      expect(disabledCheckboxes.length).toBeGreaterThan(0)
    })

    it('should render checkboxes with shrink-0 class for consistent sizing', () => {
      // Arrange & Act
      const { container } = render(<ParagraphListSkeleton />)

      // Assert
      const checkboxContainers = container.querySelectorAll('.shrink-0')
      expect(checkboxContainers.length).toBeGreaterThan(0)
    })
  })

  // Divider tests
  describe('Dividers', () => {
    it('should render dividers between items except for the last one', () => {
      // Arrange & Act
      const { container } = render(<ParagraphListSkeleton />)

      // Assert - should have 9 dividers (not after last item)
      const dividers = container.querySelectorAll('.bg-divider-subtle')
      expect(dividers).toHaveLength(9)
    })
  })

  // Structure tests
  describe('Structure', () => {
    it('should render arrow icon for expand button styling', () => {
      // Arrange & Act
      const { container } = render(<ParagraphListSkeleton />)

      // Assert - paragraph list skeleton has expand button styled area
      const expandBtnElements = container.querySelectorAll('.bg-dataset-child-chunk-expand-btn-bg')
      expect(expandBtnElements.length).toBeGreaterThan(0)
    })

    it('should render skeleton rectangles with quaternary text color', () => {
      // Arrange & Act
      const { container } = render(<ParagraphListSkeleton />)

      // Assert
      const skeletonElements = container.querySelectorAll('.bg-text-quaternary')
      expect(skeletonElements.length).toBeGreaterThan(0)
    })

    it('should render CardSkelton inside each list item', () => {
      // Arrange & Act
      const { container } = render(<ParagraphListSkeleton />)

      // Assert - each list item should contain card skeleton content
      const cardContainers = container.querySelectorAll('.grow')
      expect(cardContainers.length).toBeGreaterThan(0)
    })
  })

  // Memoization tests
  describe('Memoization', () => {
    it('should render consistently across multiple renders', () => {
      // Arrange & Act
      const { container: container1 } = render(<ParagraphListSkeleton />)
      const { container: container2 } = render(<ParagraphListSkeleton />)

      // Assert
      const items1 = container1.querySelectorAll('.items-start.gap-x-2')
      const items2 = container2.querySelectorAll('.items-start.gap-x-2')
      expect(items1.length).toBe(items2.length)
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should maintain structure when rerendered', () => {
      // Arrange
      const { rerender, container } = render(<ParagraphListSkeleton />)

      // Act
      rerender(<ParagraphListSkeleton />)

      // Assert
      const listItems = container.querySelectorAll('.items-start.gap-x-2')
      expect(listItems).toHaveLength(10)
    })

    it('should not have interactive elements besides disabled checkboxes', () => {
      // Arrange & Act
      const { container } = render(<ParagraphListSkeleton />)

      // Assert
      const buttons = container.querySelectorAll('button')
      const links = container.querySelectorAll('a')
      expect(buttons).toHaveLength(0)
      expect(links).toHaveLength(0)
    })
  })
})
