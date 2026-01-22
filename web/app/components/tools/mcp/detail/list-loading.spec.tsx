import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ListLoading from './list-loading'

describe('ListLoading', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<ListLoading />)

      // Should render the container with space-y-2 class
      const container = document.querySelector('.space-y-2')
      expect(container).toBeInTheDocument()
    })

    it('should render 5 loading skeleton items', () => {
      render(<ListLoading />)

      // Each skeleton item has the class bg-components-panel-on-panel-item-bg-hover
      const skeletonItems = document.querySelectorAll('.bg-components-panel-on-panel-item-bg-hover')
      expect(skeletonItems).toHaveLength(5)
    })

    it('should render skeleton items with correct structure', () => {
      render(<ListLoading />)

      // Each skeleton item should have 3 inner divs with h-2 class
      const heightBars = document.querySelectorAll('.h-2')
      // 5 items × 3 bars = 15 total
      expect(heightBars.length).toBe(15)
    })

    it('should have opacity variations for visual effect', () => {
      render(<ListLoading />)

      // Check for opacity-20 and opacity-10 classes
      const opacity20Elements = document.querySelectorAll('.opacity-20')
      const opacity10Elements = document.querySelectorAll('.opacity-10')

      expect(opacity20Elements.length).toBeGreaterThan(0)
      expect(opacity10Elements.length).toBeGreaterThan(0)
    })

    it('should have rounded corners on skeleton items', () => {
      render(<ListLoading />)

      const roundedItems = document.querySelectorAll('.rounded-xl')
      expect(roundedItems.length).toBe(5)
    })
  })
})
