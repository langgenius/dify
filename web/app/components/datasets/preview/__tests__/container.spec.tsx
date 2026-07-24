import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PreviewContainer from '../container'

// Tests for PreviewContainer - a layout wrapper with header and scrollable main area
describe('PreviewContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render header content in a header element', () => {
      render(<PreviewContainer header={<span>Header Title</span>}>Body</PreviewContainer>)

      expect(screen.getByText('Header Title')).toBeInTheDocument()
      const headerEl = screen.getByText('Header Title').closest('header')
      expect(headerEl).toBeInTheDocument()
    })

    it('should render children in a main element', () => {
      render(<PreviewContainer header="Header">Main content</PreviewContainer>)

      const mainEl = screen.getByRole('main')
      expect(mainEl).toHaveTextContent('Main content')
    })

    it('should render both header and children simultaneously', () => {
      render(
        <PreviewContainer header={<h2>My Header</h2>}>
          <p>Body paragraph</p>
        </PreviewContainer>,
      )

      expect(screen.getByText('My Header')).toBeInTheDocument()
      expect(screen.getByText('Body paragraph')).toBeInTheDocument()
    })

    it('should render without children', () => {
      render(<PreviewContainer header="Header" />)

      expect(screen.getByRole('main')).toBeInTheDocument()
      expect(screen.getByRole('main').childElementCount).toBe(0)
    })
  })

  describe('Props', () => {
    it('should apply className to the outer wrapper div', () => {
      const { container } = render(
        <PreviewContainer header="Header" className="outer-class">Content</PreviewContainer>,
      )

      expect(container.firstElementChild).toHaveClass('outer-class')
    })

    it('should apply mainClassName to the main element', () => {
      render(
        <PreviewContainer header="Header" mainClassName="custom-main">Content</PreviewContainer>,
      )

      const mainEl = screen.getByRole('main')
      expect(mainEl).toHaveClass('custom-main')
      // Default classes should still be present
      expect(mainEl).toHaveClass('w-full', 'grow', 'overflow-y-auto', 'px-6', 'py-5')
    })

    it('should forward ref to the inner container div', () => {
      const ref = vi.fn()
      render(
        <PreviewContainer header="Header" ref={ref}>Content</PreviewContainer>,
      )

      expect(ref).toHaveBeenCalled()
      const refArg = ref.mock.calls[0][0]
      expect(refArg).toBeInstanceOf(HTMLDivElement)
    })

    it('should pass rest props to the inner container div', () => {
      render(
        <PreviewContainer header="Header" data-testid="inner-container" id="container-1">
          Content
        </PreviewContainer>,
      )

      const inner = screen.getByTestId('inner-container')
      expect(inner).toHaveAttribute('id', 'container-1')
    })

    it('should render ReactNode as header', () => {
      render(
        <PreviewContainer header={<div data-testid="complex-header"><span>Complex</span></div>}>
          Content
        </PreviewContainer>,
      )

      expect(screen.getByTestId('complex-header')).toBeInTheDocument()
      expect(screen.getByText('Complex')).toBeInTheDocument()
    })
  })

  // Layout structure tests
  describe('Layout Structure', () => {
    it('should have header with border-b styling', () => {
      render(<PreviewContainer header="Header">Content</PreviewContainer>)

      const headerEl = screen.getByText('Header').closest('header')
      expect(headerEl).toHaveClass('border-b', 'border-divider-subtle')
    })

    it('should have inner div with flex column layout', () => {
      render(
        <PreviewContainer header="Header" data-testid="inner">Content</PreviewContainer>,
      )

      const inner = screen.getByTestId('inner')
      expect(inner).toHaveClass('flex', 'h-full', 'w-full', 'flex-col')
    })

    it('should have main with overflow-y-auto for scrolling', () => {
      render(<PreviewContainer header="Header">Content</PreviewContainer>)

      expect(screen.getByRole('main')).toHaveClass('overflow-y-auto')
    })
  })

  // DisplayName test
  describe('DisplayName', () => {
    it('should have correct displayName', () => {
      expect(PreviewContainer.displayName).toBe('PreviewContainer')
    })
  })

  describe('Edge Cases', () => {
    it('should render with empty string header', () => {
      render(<PreviewContainer header="">Content</PreviewContainer>)

      const headerEl = screen.getByRole('banner')
      expect(headerEl).toBeInTheDocument()
    })

    it('should render with null children', () => {
      render(<PreviewContainer header="Header">{null}</PreviewContainer>)

      expect(screen.getByRole('main')).toBeInTheDocument()
    })

    it('should render with multiple children', () => {
      render(
        <PreviewContainer header="Header">
          <div>Child 1</div>
          <div>Child 2</div>
          <div>Child 3</div>
        </PreviewContainer>,
      )

      expect(screen.getByText('Child 1')).toBeInTheDocument()
      expect(screen.getByText('Child 2')).toBeInTheDocument()
      expect(screen.getByText('Child 3')).toBeInTheDocument()
    })

    it('should not crash on re-render with different props', () => {
      const { rerender } = render(
        <PreviewContainer header="First" className="a">Content A</PreviewContainer>,
      )

      rerender(
        <PreviewContainer header="Second" className="b" mainClassName="new-main">Content B</PreviewContainer>,
      )

      expect(screen.getByText('Second')).toBeInTheDocument()
      expect(screen.getByText('Content B')).toBeInTheDocument()
    })
  })
})
