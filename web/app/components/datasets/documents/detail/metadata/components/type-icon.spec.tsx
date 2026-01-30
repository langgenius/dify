import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import TypeIcon from './type-icon'

describe('TypeIcon', () => {
  describe('rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<TypeIcon iconName="book" />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should apply commonIcon class', () => {
      const { container } = render(<TypeIcon iconName="book" />)
      const icon = container.firstChild as HTMLElement
      expect(icon.className).toContain('commonIcon')
    })

    it('should apply icon-specific class based on iconName', () => {
      const { container } = render(<TypeIcon iconName="book" />)
      const icon = container.firstChild as HTMLElement
      expect(icon.className).toContain('bookIcon')
    })

    it('should apply additional className when provided', () => {
      const { container } = render(<TypeIcon iconName="book" className="custom-class" />)
      const icon = container.firstChild as HTMLElement
      expect(icon.className).toContain('custom-class')
    })

    it('should handle empty className', () => {
      const { container } = render(<TypeIcon iconName="book" className="" />)
      const icon = container.firstChild as HTMLElement
      expect(icon).toBeInTheDocument()
    })

    it('should handle different icon names', () => {
      const iconNames = ['book', 'paper', 'web_page', 'social_media_post', 'wikipedia_entry', 'personal_document', 'business_document']

      iconNames.forEach((iconName) => {
        const { container } = render(<TypeIcon iconName={iconName} />)
        const icon = container.firstChild as HTMLElement
        expect(icon.className).toContain(`${iconName}Icon`)
      })
    })
  })

  describe('memoization', () => {
    it('should be memoized', () => {
      const { container, rerender } = render(<TypeIcon iconName="book" />)
      const firstRender = container.innerHTML

      rerender(<TypeIcon iconName="book" />)
      expect(container.innerHTML).toBe(firstRender)
    })
  })
})
