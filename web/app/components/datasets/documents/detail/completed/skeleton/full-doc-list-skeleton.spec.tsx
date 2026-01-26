import { render } from '@testing-library/react'
import FullDocListSkeleton from './full-doc-list-skeleton'

describe('FullDocListSkeleton', () => {
  describe('Rendering', () => {
    it('should render the skeleton container', () => {
      const { container } = render(<FullDocListSkeleton />)

      const skeletonContainer = container.firstChild
      expect(skeletonContainer).toHaveClass('flex', 'w-full', 'grow', 'flex-col')
    })

    it('should render 15 Slice components', () => {
      const { container } = render(<FullDocListSkeleton />)

      // Each Slice has a specific structure with gap-y-1
      const slices = container.querySelectorAll('.gap-y-1')
      expect(slices.length).toBe(15)
    })

    it('should render mask overlay', () => {
      const { container } = render(<FullDocListSkeleton />)

      const maskOverlay = container.querySelector('.bg-dataset-chunk-list-mask-bg')
      expect(maskOverlay).toBeInTheDocument()
    })

    it('should have overflow hidden', () => {
      const { container } = render(<FullDocListSkeleton />)

      const skeletonContainer = container.firstChild
      expect(skeletonContainer).toHaveClass('overflow-y-hidden')
    })
  })

  describe('Slice Component', () => {
    it('should render slice with correct structure', () => {
      const { container } = render(<FullDocListSkeleton />)

      // Each slice has two rows
      const sliceRows = container.querySelectorAll('.bg-state-base-hover')
      expect(sliceRows.length).toBeGreaterThan(0)
    })

    it('should render label placeholder in each slice', () => {
      const { container } = render(<FullDocListSkeleton />)

      // Label placeholder has specific width
      const labelPlaceholders = container.querySelectorAll('.w-\\[30px\\]')
      expect(labelPlaceholders.length).toBe(15) // One per slice
    })

    it('should render content placeholder in each slice', () => {
      const { container } = render(<FullDocListSkeleton />)

      // Content placeholder has 2/3 width
      const contentPlaceholders = container.querySelectorAll('.w-2\\/3')
      expect(contentPlaceholders.length).toBe(15) // One per slice
    })
  })

  describe('Memoization', () => {
    it('should be memoized', () => {
      const { rerender, container } = render(<FullDocListSkeleton />)

      const initialContent = container.innerHTML

      // Rerender should produce same output
      rerender(<FullDocListSkeleton />)

      expect(container.innerHTML).toBe(initialContent)
    })
  })

  describe('Styling', () => {
    it('should have correct z-index layering', () => {
      const { container } = render(<FullDocListSkeleton />)

      const skeletonContainer = container.firstChild
      expect(skeletonContainer).toHaveClass('z-10')

      const maskOverlay = container.querySelector('.z-20')
      expect(maskOverlay).toBeInTheDocument()
    })

    it('should have gap between slices', () => {
      const { container } = render(<FullDocListSkeleton />)

      const skeletonContainer = container.firstChild
      expect(skeletonContainer).toHaveClass('gap-y-3')
    })
  })
})
