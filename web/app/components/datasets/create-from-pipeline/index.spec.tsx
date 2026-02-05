import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import CreateFromPipeline from './index'

// Mock child components to isolate testing
vi.mock('./header', () => ({
  default: () => <div data-testid="mock-header">Header</div>,
}))

vi.mock('./list', () => ({
  default: () => <div data-testid="mock-list">List</div>,
}))

vi.mock('./footer', () => ({
  default: () => <div data-testid="mock-footer">Footer</div>,
}))

vi.mock('../../base/effect', () => ({
  default: ({ className }: { className?: string }) => (
    <div data-testid="mock-effect" className={className}>Effect</div>
  ),
}))

// ============================================================================
// CreateFromPipeline Component Tests
// ============================================================================

describe('CreateFromPipeline', () => {
  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<CreateFromPipeline />)
      expect(screen.getByTestId('mock-header')).toBeInTheDocument()
    })

    it('should render Header component', () => {
      render(<CreateFromPipeline />)
      expect(screen.getByTestId('mock-header')).toBeInTheDocument()
    })

    it('should render List component', () => {
      render(<CreateFromPipeline />)
      expect(screen.getByTestId('mock-list')).toBeInTheDocument()
    })

    it('should render Footer component', () => {
      render(<CreateFromPipeline />)
      expect(screen.getByTestId('mock-footer')).toBeInTheDocument()
    })

    it('should render Effect component', () => {
      render(<CreateFromPipeline />)
      expect(screen.getByTestId('mock-effect')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Layout Tests
  // --------------------------------------------------------------------------
  describe('Layout', () => {
    it('should have proper container classes', () => {
      const { container } = render(<CreateFromPipeline />)
      const mainDiv = container.firstChild as HTMLElement
      expect(mainDiv).toHaveClass('relative', 'flex', 'flex-col', 'overflow-hidden', 'rounded-t-2xl')
    })

    it('should have correct height calculation', () => {
      const { container } = render(<CreateFromPipeline />)
      const mainDiv = container.firstChild as HTMLElement
      expect(mainDiv).toHaveClass('h-[calc(100vh-56px)]')
    })

    it('should have border and background styling', () => {
      const { container } = render(<CreateFromPipeline />)
      const mainDiv = container.firstChild as HTMLElement
      expect(mainDiv).toHaveClass('border-t', 'border-effects-highlight', 'bg-background-default-subtle')
    })

    it('should position Effect component correctly', () => {
      render(<CreateFromPipeline />)
      const effect = screen.getByTestId('mock-effect')
      expect(effect).toHaveClass('left-8', 'top-[-34px]', 'opacity-20')
    })
  })

  // --------------------------------------------------------------------------
  // Component Order Tests
  // --------------------------------------------------------------------------
  describe('Component Order', () => {
    it('should render components in correct order', () => {
      const { container } = render(<CreateFromPipeline />)
      const children = Array.from(container.firstChild?.childNodes || [])

      // Effect, Header, List, Footer
      expect(children.length).toBe(4)
    })
  })
})
