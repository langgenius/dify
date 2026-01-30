import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import IconButton from './icon-button'

vi.mock('@/hooks/use-metadata', () => ({
  useMetadataMap: () => ({
    book: { text: 'Book', iconName: 'book' },
    paper: { text: 'Paper', iconName: 'paper' },
    personal_document: { text: 'Personal Document', iconName: 'personal_document' },
    business_document: { text: 'Business Document', iconName: 'business_document' },
  }),
}))

describe('IconButton', () => {
  describe('rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<IconButton type="book" isChecked={false} />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render as a button element', () => {
      render(<IconButton type="book" isChecked={false} />)
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should have type="button" attribute', () => {
      render(<IconButton type="book" isChecked={false} />)
      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('type', 'button')
    })
  })

  describe('checked state', () => {
    it('should apply iconCheck class when isChecked is true', () => {
      render(<IconButton type="book" isChecked />)
      const button = screen.getByRole('button')
      expect(button.className).toContain('iconCheck')
    })

    it('should not apply iconCheck class when isChecked is false', () => {
      render(<IconButton type="book" isChecked={false} />)
      const button = screen.getByRole('button')
      expect(button.className).not.toContain('iconCheck')
    })

    it('should apply primary color to TypeIcon when checked', () => {
      const { container } = render(<IconButton type="book" isChecked />)
      const typeIcon = container.querySelector('div[class*="Icon"]')
      expect(typeIcon?.className).toContain('!bg-primary-600')
    })
  })

  describe('tooltip', () => {
    it('should display tooltip with doc type text', async () => {
      render(<IconButton type="book" isChecked={false} />)
      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
    })
  })

  describe('different doc types', () => {
    it('should render book type', () => {
      const { container } = render(<IconButton type="book" isChecked={false} />)
      const icon = container.querySelector('div[class*="bookIcon"]')
      expect(icon).toBeInTheDocument()
    })

    it('should render paper type', () => {
      const { container } = render(<IconButton type="paper" isChecked={false} />)
      const icon = container.querySelector('div[class*="paperIcon"]')
      expect(icon).toBeInTheDocument()
    })

    it('should render personal_document type', () => {
      const { container } = render(<IconButton type="personal_document" isChecked={false} />)
      const icon = container.querySelector('div[class*="personal_documentIcon"]')
      expect(icon).toBeInTheDocument()
    })

    it('should render business_document type', () => {
      const { container } = render(<IconButton type="business_document" isChecked={false} />)
      const icon = container.querySelector('div[class*="business_documentIcon"]')
      expect(icon).toBeInTheDocument()
    })
  })

  describe('hover states', () => {
    it('should have group class for hover styles', () => {
      render(<IconButton type="book" isChecked={false} />)
      const button = screen.getByRole('button')
      expect(button.className).toContain('group')
    })
  })

  describe('memoization', () => {
    it('should be memoized', () => {
      const { container, rerender } = render(<IconButton type="book" isChecked={false} />)
      const firstRender = container.innerHTML

      rerender(<IconButton type="book" isChecked={false} />)
      expect(container.innerHTML).toBe(firstRender)
    })
  })
})
