import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import GeneralListSkeleton, { CardSkelton } from './general-list-skeleton'

describe('CardSkelton', () => {
  // Rendering tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      const { container } = render(<CardSkelton />)

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render skeleton rows', () => {
      // Arrange & Act
      const { container } = render(<CardSkelton />)

      // Assert - component should have skeleton rectangle elements
      const skeletonRectangles = container.querySelectorAll('.bg-text-quaternary')
      expect(skeletonRectangles.length).toBeGreaterThan(0)
    })

    it('should render with proper container padding', () => {
      // Arrange & Act
      const { container } = render(<CardSkelton />)

      // Assert
      expect(container.querySelector('.p-1')).toBeInTheDocument()
      expect(container.querySelector('.pb-2')).toBeInTheDocument()
    })
  })

  // Structure tests
  describe('Structure', () => {
    it('should render skeleton points as separators', () => {
      // Arrange & Act
      const { container } = render(<CardSkelton />)

      // Assert - check for opacity class on skeleton points
      const opacityElements = container.querySelectorAll('.opacity-20')
      expect(opacityElements.length).toBeGreaterThan(0)
    })

    it('should render width-constrained skeleton elements', () => {
      // Arrange & Act
      const { container } = render(<CardSkelton />)

      // Assert - check for various width classes
      expect(container.querySelector('.w-\\[72px\\]')).toBeInTheDocument()
      expect(container.querySelector('.w-24')).toBeInTheDocument()
      expect(container.querySelector('.w-full')).toBeInTheDocument()
    })
  })
})

describe('GeneralListSkeleton', () => {
  // Rendering tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      const { container } = render(<GeneralListSkeleton />)

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render the correct number of list items', () => {
      // Arrange & Act
      const { container } = render(<GeneralListSkeleton />)

      // Assert - component renders 10 items (Checkbox is a div with shrink-0 and h-4 w-4)
      const listItems = container.querySelectorAll('.items-start.gap-x-2')
      expect(listItems).toHaveLength(10)
    })

    it('should render mask overlay element', () => {
      // Arrange & Act
      const { container } = render(<GeneralListSkeleton />)

      // Assert
      const maskElement = container.querySelector('.bg-dataset-chunk-list-mask-bg')
      expect(maskElement).toBeInTheDocument()
    })

    it('should render with correct container classes', () => {
      // Arrange & Act
      const { container } = render(<GeneralListSkeleton />)

      // Assert
      const containerElement = container.firstChild as HTMLElement
      expect(containerElement).toHaveClass('relative')
      expect(containerElement).toHaveClass('z-10')
      expect(containerElement).toHaveClass('flex')
      expect(containerElement).toHaveClass('grow')
      expect(containerElement).toHaveClass('flex-col')
      expect(containerElement).toHaveClass('overflow-y-hidden')
    })
  })

  // Checkbox tests
  describe('Checkboxes', () => {
    it('should render disabled checkboxes', () => {
      // Arrange & Act
      const { container } = render(<GeneralListSkeleton />)

      // Assert - Checkbox component uses cursor-not-allowed class when disabled
      const disabledCheckboxes = container.querySelectorAll('.cursor-not-allowed')
      expect(disabledCheckboxes.length).toBeGreaterThan(0)
    })

    it('should render checkboxes with shrink-0 class for consistent sizing', () => {
      // Arrange & Act
      const { container } = render(<GeneralListSkeleton />)

      // Assert
      const checkboxContainers = container.querySelectorAll('.shrink-0')
      expect(checkboxContainers.length).toBeGreaterThan(0)
    })
  })

  // Divider tests
  describe('Dividers', () => {
    it('should render dividers between items except for the last one', () => {
      // Arrange & Act
      const { container } = render(<GeneralListSkeleton />)

      // Assert - should have 9 dividers (not after last item)
      const dividers = container.querySelectorAll('.bg-divider-subtle')
      expect(dividers).toHaveLength(9)
    })
  })

  // Structure tests
  describe('Structure', () => {
    it('should render list items with proper gap styling', () => {
      // Arrange & Act
      const { container } = render(<GeneralListSkeleton />)

      // Assert
      const listItems = container.querySelectorAll('.gap-x-2')
      expect(listItems.length).toBeGreaterThan(0)
    })

    it('should render CardSkelton inside each list item', () => {
      // Arrange & Act
      const { container } = render(<GeneralListSkeleton />)

      // Assert - each list item should contain card skeleton content
      const cardContainers = container.querySelectorAll('.grow')
      expect(cardContainers.length).toBeGreaterThan(0)
    })
  })

  // Memoization tests
  describe('Memoization', () => {
    it('should render consistently across multiple renders', () => {
      // Arrange & Act
      const { container: container1 } = render(<GeneralListSkeleton />)
      const { container: container2 } = render(<GeneralListSkeleton />)

      // Assert
      const checkboxes1 = container1.querySelectorAll('input[type="checkbox"]')
      const checkboxes2 = container2.querySelectorAll('input[type="checkbox"]')
      expect(checkboxes1.length).toBe(checkboxes2.length)
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should maintain structure when rerendered', () => {
      // Arrange
      const { rerender, container } = render(<GeneralListSkeleton />)

      // Act
      rerender(<GeneralListSkeleton />)

      // Assert
      const listItems = container.querySelectorAll('.items-start.gap-x-2')
      expect(listItems).toHaveLength(10)
    })

    it('should not have interactive elements besides disabled checkboxes', () => {
      // Arrange & Act
      const { container } = render(<GeneralListSkeleton />)

      // Assert
      const buttons = container.querySelectorAll('button')
      const links = container.querySelectorAll('a')
      expect(buttons).toHaveLength(0)
      expect(links).toHaveLength(0)
    })
  })
})
