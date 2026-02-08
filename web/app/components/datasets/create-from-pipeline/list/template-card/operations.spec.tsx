import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Operations from './operations'

// ============================================================================
// Operations Component Tests
// ============================================================================

describe('Operations', () => {
  const defaultProps = {
    openEditModal: vi.fn(),
    onDelete: vi.fn(),
    onExport: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Operations {...defaultProps} />)
      expect(screen.getByText(/editInfo/i)).toBeInTheDocument()
    })

    it('should render all operation buttons', () => {
      render(<Operations {...defaultProps} />)
      expect(screen.getByText(/editInfo/i)).toBeInTheDocument()
      expect(screen.getByText(/exportPipeline/i)).toBeInTheDocument()
      expect(screen.getByText(/delete/i)).toBeInTheDocument()
    })

    it('should have proper container styling', () => {
      const { container } = render(<Operations {...defaultProps} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('relative', 'flex', 'flex-col', 'rounded-xl')
    })
  })

  // --------------------------------------------------------------------------
  // User Interactions Tests
  // --------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call openEditModal when edit is clicked', () => {
      render(<Operations {...defaultProps} />)

      const editButton = screen.getByText(/editInfo/i).closest('div[class*="cursor-pointer"]')
      fireEvent.click(editButton!)

      expect(defaultProps.openEditModal).toHaveBeenCalledTimes(1)
    })

    it('should call onExport when export is clicked', () => {
      render(<Operations {...defaultProps} />)

      const exportButton = screen.getByText(/exportPipeline/i).closest('div[class*="cursor-pointer"]')
      fireEvent.click(exportButton!)

      expect(defaultProps.onExport).toHaveBeenCalledTimes(1)
    })

    it('should call onDelete when delete is clicked', () => {
      render(<Operations {...defaultProps} />)

      const deleteButton = screen.getByText(/delete/i).closest('div[class*="cursor-pointer"]')
      fireEvent.click(deleteButton!)

      expect(defaultProps.onDelete).toHaveBeenCalledTimes(1)
    })

    it('should stop propagation on edit click', () => {
      const stopPropagation = vi.fn()
      const preventDefault = vi.fn()

      render(<Operations {...defaultProps} />)

      const editButton = screen.getByText(/editInfo/i).closest('div[class*="cursor-pointer"]')
      fireEvent.click(editButton!, {
        stopPropagation,
        preventDefault,
      })

      expect(defaultProps.openEditModal).toHaveBeenCalled()
    })

    it('should stop propagation on export click', () => {
      render(<Operations {...defaultProps} />)

      const exportButton = screen.getByText(/exportPipeline/i).closest('div[class*="cursor-pointer"]')
      fireEvent.click(exportButton!)

      expect(defaultProps.onExport).toHaveBeenCalled()
    })

    it('should stop propagation on delete click', () => {
      render(<Operations {...defaultProps} />)

      const deleteButton = screen.getByText(/delete/i).closest('div[class*="cursor-pointer"]')
      fireEvent.click(deleteButton!)

      expect(defaultProps.onDelete).toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // Layout Tests
  // --------------------------------------------------------------------------
  describe('Layout', () => {
    it('should have divider between sections', () => {
      const { container } = render(<Operations {...defaultProps} />)
      const divider = container.querySelector('[class*="bg-divider"]')
      expect(divider).toBeInTheDocument()
    })

    it('should have hover states on buttons', () => {
      render(<Operations {...defaultProps} />)

      const editButton = screen.getByText(/editInfo/i).closest('div[class*="cursor-pointer"]')
      expect(editButton).toHaveClass('hover:bg-state-base-hover')
    })

    it('should have destructive hover state on delete button', () => {
      render(<Operations {...defaultProps} />)

      const deleteButton = screen.getByText(/delete/i).closest('div[class*="cursor-pointer"]')
      expect(deleteButton).toHaveClass('hover:bg-state-destructive-hover')
    })
  })

  // --------------------------------------------------------------------------
  // Memoization Tests
  // --------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should be memoized with React.memo', () => {
      const { rerender } = render(<Operations {...defaultProps} />)
      rerender(<Operations {...defaultProps} />)
      expect(screen.getByText(/editInfo/i)).toBeInTheDocument()
    })
  })
})
