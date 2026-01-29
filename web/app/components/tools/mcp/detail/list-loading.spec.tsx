import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ListLoading from './list-loading'

describe('ListLoading', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<ListLoading />)
      expect(container).toBeInTheDocument()
    })

    it('should render 5 skeleton items', () => {
      render(<ListLoading />)
      const skeletonItems = document.querySelectorAll('[class*="bg-components-panel-on-panel-item-bg-hover"]')
      expect(skeletonItems.length).toBe(5)
    })

    it('should have rounded-xl class on skeleton items', () => {
      render(<ListLoading />)
      const skeletonItems = document.querySelectorAll('.rounded-xl')
      expect(skeletonItems.length).toBeGreaterThanOrEqual(5)
    })

    it('should have proper spacing', () => {
      render(<ListLoading />)
      const container = document.querySelector('.space-y-2')
      expect(container).toBeInTheDocument()
    })

    it('should render placeholder bars with different widths', () => {
      render(<ListLoading />)
      const bar180 = document.querySelector('.w-\\[180px\\]')
      const bar148 = document.querySelector('.w-\\[148px\\]')
      const bar196 = document.querySelector('.w-\\[196px\\]')

      expect(bar180).toBeInTheDocument()
      expect(bar148).toBeInTheDocument()
      expect(bar196).toBeInTheDocument()
    })

    it('should have opacity styling on skeleton bars', () => {
      render(<ListLoading />)
      const opacity20Bars = document.querySelectorAll('.opacity-20')
      const opacity10Bars = document.querySelectorAll('.opacity-10')

      expect(opacity20Bars.length).toBeGreaterThan(0)
      expect(opacity10Bars.length).toBeGreaterThan(0)
    })
  })

  describe('Structure', () => {
    it('should have correct nested structure', () => {
      render(<ListLoading />)
      const items = document.querySelectorAll('.space-y-3')
      expect(items.length).toBe(5)
    })

    it('should render padding on skeleton items', () => {
      render(<ListLoading />)
      const paddedItems = document.querySelectorAll('.p-4')
      expect(paddedItems.length).toBe(5)
    })

    it('should render height-2 skeleton bars', () => {
      render(<ListLoading />)
      const h2Bars = document.querySelectorAll('.h-2')
      // 3 bars per skeleton item * 5 items = 15
      expect(h2Bars.length).toBe(15)
    })
  })
})
