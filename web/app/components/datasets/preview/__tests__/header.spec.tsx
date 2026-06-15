import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PreviewHeader } from '../header'

// Tests for PreviewHeader - displays a title and optional children
describe('PreviewHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render the title text', () => {
      render(<PreviewHeader title="Preview Title" />)

      expect(screen.getByText('Preview Title')).toBeInTheDocument()
    })

    it('should render children below the title', () => {
      render(
        <PreviewHeader title="Title">
          <span>Child content</span>
        </PreviewHeader>,
      )

      expect(screen.getByText('Title')).toBeInTheDocument()
      expect(screen.getByText('Child content')).toBeInTheDocument()
    })

    it('should render without children', () => {
      const { container } = render(<PreviewHeader title="Solo Title" />)

      expect(container.firstElementChild).toBeInTheDocument()
      expect(screen.getByText('Solo Title')).toBeInTheDocument()
    })

    it('should render title in an inner div with uppercase styling', () => {
      render(<PreviewHeader title="Styled Title" />)

      const titleEl = screen.getByText('Styled Title')
      expect(titleEl).toHaveClass('uppercase', 'mb-1', 'px-1', 'text-text-accent')
    })
  })

  describe('Props', () => {
    it('should apply custom className to outer div', () => {
      render(<PreviewHeader title="Title" className="custom-header" data-testid="header" />)

      expect(screen.getByTestId('header')).toHaveClass('custom-header')
    })

    it('should pass rest props to the outer div', () => {
      render(<PreviewHeader title="Title" data-testid="header" id="header-1" aria-label="preview header" />)

      const el = screen.getByTestId('header')
      expect(el).toHaveAttribute('id', 'header-1')
      expect(el).toHaveAttribute('aria-label', 'preview header')
    })

    it('should render with empty string title', () => {
      render(<PreviewHeader title="" data-testid="header" />)

      const header = screen.getByTestId('header')
      // Title div exists but is empty
      const titleDiv = header.querySelector('.uppercase')
      expect(titleDiv).toBeInTheDocument()
      expect(titleDiv?.textContent).toBe('')
    })
  })

  describe('Structure', () => {
    it('should render as a div element', () => {
      render(<PreviewHeader title="Title" data-testid="header" />)

      expect(screen.getByTestId('header').tagName).toBe('DIV')
    })

    it('should have title div as the first child', () => {
      render(<PreviewHeader title="Title" data-testid="header" />)

      const header = screen.getByTestId('header')
      const firstChild = header.firstElementChild
      expect(firstChild).toHaveTextContent('Title')
    })

    it('should place children after the title div', () => {
      render(
        <PreviewHeader title="Title" data-testid="header">
          <button>Action</button>
        </PreviewHeader>,
      )

      const header = screen.getByTestId('header')
      const children = Array.from(header.children)
      expect(children).toHaveLength(2)
      expect(children[0]).toHaveTextContent('Title')
      expect(children[1]).toHaveTextContent('Action')
    })
  })

  describe('Edge Cases', () => {
    it('should handle special characters in title', () => {
      render(<PreviewHeader title="Test & <Special> 'Characters'" />)

      expect(screen.getByText('Test & <Special> \'Characters\'')).toBeInTheDocument()
    })

    it('should handle long titles', () => {
      const longTitle = 'A'.repeat(500)
      render(<PreviewHeader title={longTitle} />)

      expect(screen.getByText(longTitle)).toBeInTheDocument()
    })

    it('should render multiple children', () => {
      render(
        <PreviewHeader title="Title">
          <span>First</span>
          <span>Second</span>
        </PreviewHeader>,
      )

      expect(screen.getByText('First')).toBeInTheDocument()
      expect(screen.getByText('Second')).toBeInTheDocument()
    })

    it('should render with null children', () => {
      render(<PreviewHeader title="Title">{null}</PreviewHeader>)

      expect(screen.getByText('Title')).toBeInTheDocument()
    })

    it('should not crash on re-render with different title', () => {
      const { rerender } = render(<PreviewHeader title="First Title" />)

      rerender(<PreviewHeader title="Second Title" />)

      expect(screen.queryByText('First Title')).not.toBeInTheDocument()
      expect(screen.getByText('Second Title')).toBeInTheDocument()
    })
  })
})
