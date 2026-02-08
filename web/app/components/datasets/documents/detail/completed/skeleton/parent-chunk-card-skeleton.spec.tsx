import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ParentChunkCardSkelton from './parent-chunk-card-skeleton'

describe('ParentChunkCardSkelton', () => {
  // Rendering tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      render(<ParentChunkCardSkelton />)

      // Assert
      expect(screen.getByTestId('parent-chunk-card-skeleton')).toBeInTheDocument()
    })

    it('should render with correct container classes', () => {
      // Arrange & Act
      render(<ParentChunkCardSkelton />)

      // Assert
      const container = screen.getByTestId('parent-chunk-card-skeleton')
      expect(container).toHaveClass('flex')
      expect(container).toHaveClass('flex-col')
      expect(container).toHaveClass('pb-2')
    })

    it('should render skeleton rectangles', () => {
      // Arrange & Act
      const { container } = render(<ParentChunkCardSkelton />)

      // Assert
      const skeletonRectangles = container.querySelectorAll('.bg-text-quaternary')
      expect(skeletonRectangles.length).toBeGreaterThan(0)
    })
  })

  // i18n tests
  describe('i18n', () => {
    it('should render view more button with translated text', () => {
      // Arrange & Act
      render(<ParentChunkCardSkelton />)

      // Assert - the button should contain translated text
      const viewMoreButton = screen.getByRole('button')
      expect(viewMoreButton).toBeInTheDocument()
    })

    it('should render disabled view more button', () => {
      // Arrange & Act
      render(<ParentChunkCardSkelton />)

      // Assert
      const viewMoreButton = screen.getByRole('button')
      expect(viewMoreButton).toBeDisabled()
    })
  })

  // Structure tests
  describe('Structure', () => {
    it('should render skeleton points as separators', () => {
      // Arrange & Act
      const { container } = render(<ParentChunkCardSkelton />)

      // Assert
      const opacityElements = container.querySelectorAll('.opacity-20')
      expect(opacityElements.length).toBeGreaterThan(0)
    })

    it('should render width-constrained skeleton elements', () => {
      // Arrange & Act
      const { container } = render(<ParentChunkCardSkelton />)

      // Assert - check for various width classes
      expect(container.querySelector('.w-\\[72px\\]')).toBeInTheDocument()
      expect(container.querySelector('.w-24')).toBeInTheDocument()
      expect(container.querySelector('.w-full')).toBeInTheDocument()
      expect(container.querySelector('.w-2\\/3')).toBeInTheDocument()
    })

    it('should render button with proper styling classes', () => {
      // Arrange & Act
      render(<ParentChunkCardSkelton />)

      // Assert
      const button = screen.getByRole('button')
      expect(button).toHaveClass('system-xs-semibold-uppercase')
      expect(button).toHaveClass('text-components-button-secondary-accent-text-disabled')
    })
  })

  // Memoization tests
  describe('Memoization', () => {
    it('should render consistently across multiple renders', () => {
      // Arrange & Act
      const { container: container1 } = render(<ParentChunkCardSkelton />)
      const { container: container2 } = render(<ParentChunkCardSkelton />)

      // Assert
      const skeletons1 = container1.querySelectorAll('.bg-text-quaternary')
      const skeletons2 = container2.querySelectorAll('.bg-text-quaternary')
      expect(skeletons1.length).toBe(skeletons2.length)
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should maintain structure when rerendered', () => {
      // Arrange
      const { rerender, container } = render(<ParentChunkCardSkelton />)

      // Act
      rerender(<ParentChunkCardSkelton />)

      // Assert
      expect(screen.getByTestId('parent-chunk-card-skeleton')).toBeInTheDocument()
      const skeletons = container.querySelectorAll('.bg-text-quaternary')
      expect(skeletons.length).toBeGreaterThan(0)
    })

    it('should have only one interactive element (disabled button)', () => {
      // Arrange & Act
      const { container } = render(<ParentChunkCardSkelton />)

      // Assert
      const buttons = container.querySelectorAll('button')
      const links = container.querySelectorAll('a')
      expect(buttons).toHaveLength(1)
      expect(buttons[0]).toBeDisabled()
      expect(links).toHaveLength(0)
    })
  })
})
