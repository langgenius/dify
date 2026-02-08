import { RiAddLine } from '@remixicon/react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Option from './option'

describe('Option', () => {
  const defaultProps = {
    Icon: RiAddLine,
    text: 'Test Option',
    href: '/test-path',
  }

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Option {...defaultProps} />)
      expect(screen.getByRole('link')).toBeInTheDocument()
    })

    it('should render the text content', () => {
      render(<Option {...defaultProps} />)
      expect(screen.getByText('Test Option')).toBeInTheDocument()
    })

    it('should render the icon', () => {
      render(<Option {...defaultProps} />)
      // Icon should be rendered with correct size class
      const icon = document.querySelector('.h-4.w-4')
      expect(icon).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should have correct href attribute', () => {
      render(<Option {...defaultProps} />)
      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('href', '/test-path')
    })

    it('should render different text based on props', () => {
      render(<Option {...defaultProps} text="Different Text" />)
      expect(screen.getByText('Different Text')).toBeInTheDocument()
    })

    it('should render different href based on props', () => {
      render(<Option {...defaultProps} href="/different-path" />)
      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('href', '/different-path')
    })
  })

  describe('Styles', () => {
    it('should have correct base styling', () => {
      render(<Option {...defaultProps} />)
      const link = screen.getByRole('link')
      expect(link).toHaveClass('flex', 'w-full', 'items-center', 'gap-x-2', 'rounded-lg')
    })

    it('should have text span with correct styling', () => {
      render(<Option {...defaultProps} />)
      const textSpan = screen.getByText('Test Option')
      expect(textSpan).toHaveClass('system-sm-medium', 'grow', 'text-left')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty text', () => {
      render(<Option {...defaultProps} text="" />)
      const link = screen.getByRole('link')
      expect(link).toBeInTheDocument()
    })

    it('should handle long text', () => {
      const longText = 'A'.repeat(100)
      render(<Option {...defaultProps} text={longText} />)
      expect(screen.getByText(longText)).toBeInTheDocument()
    })
  })
})
