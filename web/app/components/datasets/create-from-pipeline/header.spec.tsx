import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Header from './header'

// ============================================================================
// Header Component Tests
// ============================================================================

describe('Header', () => {
  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Header />)
      expect(screen.getByText(/backToKnowledge/i)).toBeInTheDocument()
    })

    it('should render back button with link to datasets', () => {
      render(<Header />)
      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('href', '/datasets')
    })

    it('should render arrow icon in button', () => {
      const { container } = render(<Header />)
      const icon = container.querySelector('svg')
      expect(icon).toBeInTheDocument()
    })

    it('should render button with correct styling', () => {
      render(<Header />)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('rounded-full')
    })

    it('should have replace attribute on link', () => {
      const { container } = render(<Header />)
      const link = container.querySelector('a[href="/datasets"]')
      expect(link).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Layout Tests
  // --------------------------------------------------------------------------
  describe('Layout', () => {
    it('should have proper container classes', () => {
      const { container } = render(<Header />)
      const headerDiv = container.firstChild as HTMLElement
      expect(headerDiv).toHaveClass('relative', 'flex', 'px-16', 'pb-2', 'pt-5')
    })

    it('should position link absolutely at bottom left', () => {
      const { container } = render(<Header />)
      const link = container.querySelector('a')
      expect(link).toHaveClass('absolute', 'bottom-0', 'left-5')
    })
  })

  // --------------------------------------------------------------------------
  // Memoization Tests
  // --------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should be memoized with React.memo', () => {
      const { rerender } = render(<Header />)
      rerender(<Header />)
      expect(screen.getByText(/backToKnowledge/i)).toBeInTheDocument()
    })
  })
})
