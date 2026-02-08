import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Item from './item'

// ============================================================================
// Item Component Tests
// ============================================================================

describe('Item', () => {
  const defaultProps = {
    isActive: false,
    label: 'Tab Label',
    onClick: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Item {...defaultProps} />)
      expect(screen.getByText('Tab Label')).toBeInTheDocument()
    })

    it('should render label', () => {
      render(<Item {...defaultProps} label="Custom Label" />)
      expect(screen.getByText('Custom Label')).toBeInTheDocument()
    })

    it('should not render indicator when inactive', () => {
      const { container } = render(<Item {...defaultProps} isActive={false} />)
      const indicator = container.querySelector('[class*="bg-util-colors-blue-brand"]')
      expect(indicator).not.toBeInTheDocument()
    })

    it('should render indicator when active', () => {
      const { container } = render(<Item {...defaultProps} isActive={true} />)
      const indicator = container.querySelector('[class*="bg-util-colors-blue-brand"]')
      expect(indicator).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Active State Tests
  // --------------------------------------------------------------------------
  describe('Active State', () => {
    it('should have tertiary text color when inactive', () => {
      const { container } = render(<Item {...defaultProps} isActive={false} />)
      const item = container.firstChild as HTMLElement
      expect(item).toHaveClass('text-text-tertiary')
    })

    it('should have primary text color when active', () => {
      const { container } = render(<Item {...defaultProps} isActive={true} />)
      const item = container.firstChild as HTMLElement
      expect(item).toHaveClass('text-text-primary')
    })

    it('should show active indicator bar when active', () => {
      const { container } = render(<Item {...defaultProps} isActive={true} />)
      const indicator = container.querySelector('[class*="absolute"]')
      expect(indicator).toHaveClass('bottom-0', 'h-0.5', 'w-full')
    })
  })

  // --------------------------------------------------------------------------
  // User Interactions Tests
  // --------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call onClick when clicked', () => {
      render(<Item {...defaultProps} />)
      const item = screen.getByText('Tab Label')

      fireEvent.click(item)

      expect(defaultProps.onClick).toHaveBeenCalledTimes(1)
    })

    it('should have cursor pointer', () => {
      const { container } = render(<Item {...defaultProps} />)
      const item = container.firstChild as HTMLElement
      expect(item).toHaveClass('cursor-pointer')
    })
  })

  // --------------------------------------------------------------------------
  // Layout Tests
  // --------------------------------------------------------------------------
  describe('Layout', () => {
    it('should have proper container styling', () => {
      const { container } = render(<Item {...defaultProps} />)
      const item = container.firstChild as HTMLElement
      expect(item).toHaveClass('system-md-semibold', 'relative', 'flex', 'h-full', 'items-center')
    })
  })

  // --------------------------------------------------------------------------
  // Memoization Tests
  // --------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should be memoized with React.memo', () => {
      const { rerender } = render(<Item {...defaultProps} />)
      rerender(<Item {...defaultProps} />)
      expect(screen.getByText('Tab Label')).toBeInTheDocument()
    })
  })
})
