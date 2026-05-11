import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ParagraphListSkeleton from '../paragraph-list-skeleton'

describe('ParagraphListSkeleton', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<ParagraphListSkeleton />)

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render the correct number of list items', () => {
      const { container } = render(<ParagraphListSkeleton />)

      // Assert - component renders 10 items
      const listItems = container.querySelectorAll('.items-start.gap-x-2')
      expect(listItems).toHaveLength(10)
    })

    it('should render mask overlay element', () => {
      const { container } = render(<ParagraphListSkeleton />)

      const maskElement = container.querySelector('.bg-dataset-chunk-list-mask-bg')
      expect(maskElement).toBeInTheDocument()
    })

    it('should render with correct container classes', () => {
      const { container } = render(<ParagraphListSkeleton />)

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
      const { container } = render(<ParagraphListSkeleton />)

      // Assert - Checkbox component uses cursor-not-allowed class when disabled
      const disabledCheckboxes = container.querySelectorAll('.cursor-not-allowed')
      expect(disabledCheckboxes.length).toBeGreaterThan(0)
    })

    it('should render checkboxes with shrink-0 class for consistent sizing', () => {
      const { container } = render(<ParagraphListSkeleton />)

      const checkboxContainers = container.querySelectorAll('.shrink-0')
      expect(checkboxContainers.length).toBeGreaterThan(0)
    })
  })

  // Divider tests
  describe('Dividers', () => {
    it('should render dividers between items except for the last one', () => {
      const { container } = render(<ParagraphListSkeleton />)

      // Assert - should have 9 dividers (not after last item)
      const dividers = container.querySelectorAll('.bg-divider-subtle')
      expect(dividers).toHaveLength(9)
    })
  })

  describe('Structure', () => {
    it('should render arrow icon for expand button styling', () => {
      const { container } = render(<ParagraphListSkeleton />)

      // Assert - paragraph list skeleton has expand button styled area
      const expandBtnElements = container.querySelectorAll('.bg-dataset-child-chunk-expand-btn-bg')
      expect(expandBtnElements.length).toBeGreaterThan(0)
    })

    it('should render skeleton rectangles with quaternary text color', () => {
      const { container } = render(<ParagraphListSkeleton />)

      const skeletonElements = container.querySelectorAll('.bg-text-quaternary')
      expect(skeletonElements.length).toBeGreaterThan(0)
    })

    it('should render CardSkelton inside each list item', () => {
      const { container } = render(<ParagraphListSkeleton />)

      // Assert - each list item should contain card skeleton content
      const cardContainers = container.querySelectorAll('.grow')
      expect(cardContainers.length).toBeGreaterThan(0)
    })
  })

  describe('Memoization', () => {
    it('should render consistently across multiple renders', () => {
      const { container: container1 } = render(<ParagraphListSkeleton />)
      const { container: container2 } = render(<ParagraphListSkeleton />)

      const items1 = container1.querySelectorAll('.items-start.gap-x-2')
      const items2 = container2.querySelectorAll('.items-start.gap-x-2')
      expect(items1.length).toBe(items2.length)
    })
  })

  describe('Edge Cases', () => {
    it('should maintain structure when rerendered', () => {
      const { rerender, container } = render(<ParagraphListSkeleton />)

      rerender(<ParagraphListSkeleton />)

      const listItems = container.querySelectorAll('.items-start.gap-x-2')
      expect(listItems).toHaveLength(10)
    })

    it('should not have interactive elements besides disabled checkboxes', () => {
      const { container } = render(<ParagraphListSkeleton />)

      const buttons = container.querySelectorAll('button')
      const links = container.querySelectorAll('a')
      expect(buttons).toHaveLength(0)
      expect(links).toHaveLength(0)
    })
  })
})
