import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Header from './header'

// ============================================================================
// Header Component Tests
// ============================================================================

describe('Header', () => {
  const defaultProps = {
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Header {...defaultProps} />)
      expect(screen.getByText(/importFromDSL/i)).toBeInTheDocument()
    })

    it('should render title', () => {
      render(<Header {...defaultProps} />)
      expect(screen.getByText(/importFromDSL/i)).toBeInTheDocument()
    })

    it('should render close button', () => {
      const { container } = render(<Header {...defaultProps} />)
      const closeButton = container.querySelector('[class*="cursor-pointer"]')
      expect(closeButton).toBeInTheDocument()
    })

    it('should render close icon', () => {
      const { container } = render(<Header {...defaultProps} />)
      const icon = container.querySelector('svg')
      expect(icon).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // User Interactions Tests
  // --------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call onClose when close button is clicked', () => {
      const { container } = render(<Header {...defaultProps} />)
      const closeButton = container.querySelector('[class*="cursor-pointer"]')

      fireEvent.click(closeButton!)

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })
  })

  // --------------------------------------------------------------------------
  // Layout Tests
  // --------------------------------------------------------------------------
  describe('Layout', () => {
    it('should have proper container styling', () => {
      const { container } = render(<Header {...defaultProps} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('title-2xl-semi-bold', 'relative', 'flex', 'items-center')
    })

    it('should have close button positioned absolutely', () => {
      const { container } = render(<Header {...defaultProps} />)
      const closeButton = container.querySelector('[class*="absolute"]')
      expect(closeButton).toHaveClass('right-5', 'top-5')
    })

    it('should have padding classes', () => {
      const { container } = render(<Header {...defaultProps} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('pb-3', 'pl-6', 'pr-14', 'pt-6')
    })
  })

  // --------------------------------------------------------------------------
  // Memoization Tests
  // --------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should be memoized with React.memo', () => {
      const { rerender } = render(<Header {...defaultProps} />)
      rerender(<Header {...defaultProps} />)
      expect(screen.getByText(/importFromDSL/i)).toBeInTheDocument()
    })
  })
})
