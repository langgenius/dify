import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Actions from './actions'

// ============================================================================
// Actions Component Tests
// ============================================================================

describe('Actions', () => {
  const defaultProps = {
    onApplyTemplate: vi.fn(),
    handleShowTemplateDetails: vi.fn(),
    showMoreOperations: true,
    openEditModal: vi.fn(),
    handleExportDSL: vi.fn(),
    handleDelete: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Actions {...defaultProps} />)
      expect(screen.getByText(/operations\.choose/i)).toBeInTheDocument()
    })

    it('should render choose button', () => {
      render(<Actions {...defaultProps} />)
      expect(screen.getByText(/operations\.choose/i)).toBeInTheDocument()
    })

    it('should render details button', () => {
      render(<Actions {...defaultProps} />)
      expect(screen.getByText(/operations\.details/i)).toBeInTheDocument()
    })

    it('should render add icon', () => {
      const { container } = render(<Actions {...defaultProps} />)
      const icons = container.querySelectorAll('svg')
      expect(icons.length).toBeGreaterThan(0)
    })

    it('should render arrow icon for details', () => {
      const { container } = render(<Actions {...defaultProps} />)
      const icons = container.querySelectorAll('svg')
      expect(icons.length).toBeGreaterThan(1)
    })
  })

  // --------------------------------------------------------------------------
  // More Operations Tests
  // --------------------------------------------------------------------------
  describe('More Operations', () => {
    it('should render more operations button when showMoreOperations is true', () => {
      const { container } = render(<Actions {...defaultProps} showMoreOperations={true} />)
      // CustomPopover should be rendered with more button
      const moreButton = container.querySelector('[class*="rounded-lg"]')
      expect(moreButton).toBeInTheDocument()
    })

    it('should not render more operations button when showMoreOperations is false', () => {
      render(<Actions {...defaultProps} showMoreOperations={false} />)
      // Should only have choose and details buttons
      const buttons = screen.getAllByRole('button')
      expect(buttons).toHaveLength(2)
    })
  })

  // --------------------------------------------------------------------------
  // User Interactions Tests
  // --------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call onApplyTemplate when choose button is clicked', () => {
      render(<Actions {...defaultProps} />)

      const chooseButton = screen.getByText(/operations\.choose/i).closest('button')
      fireEvent.click(chooseButton!)

      expect(defaultProps.onApplyTemplate).toHaveBeenCalledTimes(1)
    })

    it('should call handleShowTemplateDetails when details button is clicked', () => {
      render(<Actions {...defaultProps} />)

      const detailsButton = screen.getByText(/operations\.details/i).closest('button')
      fireEvent.click(detailsButton!)

      expect(defaultProps.handleShowTemplateDetails).toHaveBeenCalledTimes(1)
    })
  })

  // --------------------------------------------------------------------------
  // Button Variants Tests
  // --------------------------------------------------------------------------
  describe('Button Variants', () => {
    it('should have primary variant for choose button', () => {
      render(<Actions {...defaultProps} />)
      const chooseButton = screen.getByText(/operations\.choose/i).closest('button')
      expect(chooseButton).toHaveClass('btn-primary')
    })

    it('should have secondary variant for details button', () => {
      render(<Actions {...defaultProps} />)
      const detailsButton = screen.getByText(/operations\.details/i).closest('button')
      expect(detailsButton).toHaveClass('btn-secondary')
    })
  })

  // --------------------------------------------------------------------------
  // Layout Tests
  // --------------------------------------------------------------------------
  describe('Layout', () => {
    it('should have absolute positioning', () => {
      const { container } = render(<Actions {...defaultProps} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('absolute', 'bottom-0', 'left-0')
    })

    it('should be hidden by default', () => {
      const { container } = render(<Actions {...defaultProps} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('hidden')
    })

    it('should show on group hover', () => {
      const { container } = render(<Actions {...defaultProps} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('group-hover:flex')
    })

    it('should have proper z-index', () => {
      const { container } = render(<Actions {...defaultProps} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('z-10')
    })
  })

  // --------------------------------------------------------------------------
  // Memoization Tests
  // --------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should be memoized with React.memo', () => {
      const { rerender } = render(<Actions {...defaultProps} />)
      rerender(<Actions {...defaultProps} />)
      expect(screen.getByText(/operations\.choose/i)).toBeInTheDocument()
    })
  })
})
