import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Operations from './operations'

describe('Operations', () => {
  const defaultProps = {
    showDelete: true,
    showExportPipeline: true,
    openRenameModal: vi.fn(),
    handleExportPipeline: vi.fn(),
    detectIsUsedByApp: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Operations {...defaultProps} />)
      // Edit operation should always be visible
      expect(screen.getByText(/operation\.edit/)).toBeInTheDocument()
    })

    it('should render edit operation', () => {
      render(<Operations {...defaultProps} />)
      expect(screen.getByText(/operation\.edit/)).toBeInTheDocument()
    })

    it('should render export pipeline operation when showExportPipeline is true', () => {
      render(<Operations {...defaultProps} showExportPipeline={true} />)
      expect(screen.getByText(/exportPipeline/)).toBeInTheDocument()
    })

    it('should not render export pipeline operation when showExportPipeline is false', () => {
      render(<Operations {...defaultProps} showExportPipeline={false} />)
      expect(screen.queryByText(/exportPipeline/)).not.toBeInTheDocument()
    })

    it('should render delete operation when showDelete is true', () => {
      render(<Operations {...defaultProps} showDelete={true} />)
      expect(screen.getByText(/operation\.delete/)).toBeInTheDocument()
    })

    it('should not render delete operation when showDelete is false', () => {
      render(<Operations {...defaultProps} showDelete={false} />)
      expect(screen.queryByText(/operation\.delete/)).not.toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should render divider when showDelete is true', () => {
      const { container } = render(<Operations {...defaultProps} showDelete={true} />)
      const divider = container.querySelector('.bg-divider-subtle')
      expect(divider).toBeInTheDocument()
    })

    it('should not render divider when showDelete is false', () => {
      const { container } = render(<Operations {...defaultProps} showDelete={false} />)
      // Should not have the divider-subtle one (the separator before delete)
      expect(container.querySelector('.bg-divider-subtle')).toBeNull()
    })
  })

  describe('User Interactions', () => {
    it('should call openRenameModal when edit is clicked', () => {
      const openRenameModal = vi.fn()
      render(<Operations {...defaultProps} openRenameModal={openRenameModal} />)

      const editItem = screen.getByText(/operation\.edit/).closest('div')
      fireEvent.click(editItem!)

      expect(openRenameModal).toHaveBeenCalledTimes(1)
    })

    it('should call handleExportPipeline when export is clicked', () => {
      const handleExportPipeline = vi.fn()
      render(<Operations {...defaultProps} handleExportPipeline={handleExportPipeline} />)

      const exportItem = screen.getByText(/exportPipeline/).closest('div')
      fireEvent.click(exportItem!)

      expect(handleExportPipeline).toHaveBeenCalledTimes(1)
    })

    it('should call detectIsUsedByApp when delete is clicked', () => {
      const detectIsUsedByApp = vi.fn()
      render(<Operations {...defaultProps} detectIsUsedByApp={detectIsUsedByApp} />)

      const deleteItem = screen.getByText(/operation\.delete/).closest('div')
      fireEvent.click(deleteItem!)

      expect(detectIsUsedByApp).toHaveBeenCalledTimes(1)
    })
  })

  describe('Styles', () => {
    it('should have correct container styling', () => {
      const { container } = render(<Operations {...defaultProps} />)
      const operationsContainer = container.firstChild
      expect(operationsContainer).toHaveClass(
        'relative',
        'flex',
        'w-full',
        'flex-col',
        'rounded-xl',
      )
    })
  })

  describe('Edge Cases', () => {
    it('should render only edit when both showDelete and showExportPipeline are false', () => {
      render(<Operations {...defaultProps} showDelete={false} showExportPipeline={false} />)
      expect(screen.getByText(/operation\.edit/)).toBeInTheDocument()
      expect(screen.queryByText(/exportPipeline/)).not.toBeInTheDocument()
      expect(screen.queryByText(/operation\.delete/)).not.toBeInTheDocument()
    })
  })
})
