import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DropdownMenu } from '@/app/components/base/ui/dropdown-menu'
import Operations from '../operations'

function renderInMenu(ui: React.ReactElement) {
  return render(
    <DropdownMenu open>
      {ui}
    </DropdownMenu>,
  )
}

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
      renderInMenu(<Operations {...defaultProps} />)
      expect(screen.getByText(/operation\.edit/)).toBeInTheDocument()
    })

    it('should render edit operation', () => {
      renderInMenu(<Operations {...defaultProps} />)
      expect(screen.getByText(/operation\.edit/)).toBeInTheDocument()
    })

    it('should render export pipeline operation when showExportPipeline is true', () => {
      renderInMenu(<Operations {...defaultProps} showExportPipeline={true} />)
      expect(screen.getByText(/exportPipeline/)).toBeInTheDocument()
    })

    it('should not render export pipeline operation when showExportPipeline is false', () => {
      renderInMenu(<Operations {...defaultProps} showExportPipeline={false} />)
      expect(screen.queryByText(/exportPipeline/)).not.toBeInTheDocument()
    })

    it('should render delete operation when showDelete is true', () => {
      renderInMenu(<Operations {...defaultProps} showDelete={true} />)
      expect(screen.getByText(/operation\.delete/)).toBeInTheDocument()
    })

    it('should not render delete operation when showDelete is false', () => {
      renderInMenu(<Operations {...defaultProps} showDelete={false} />)
      expect(screen.queryByText(/operation\.delete/)).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call openRenameModal when edit is clicked', () => {
      const openRenameModal = vi.fn()
      renderInMenu(<Operations {...defaultProps} openRenameModal={openRenameModal} />)

      fireEvent.click(screen.getByText(/operation\.edit/))
      expect(openRenameModal).toHaveBeenCalledTimes(1)
    })

    it('should call handleExportPipeline when export is clicked', () => {
      const handleExportPipeline = vi.fn()
      renderInMenu(<Operations {...defaultProps} handleExportPipeline={handleExportPipeline} />)

      fireEvent.click(screen.getByText(/exportPipeline/))
      expect(handleExportPipeline).toHaveBeenCalledTimes(1)
    })

    it('should call detectIsUsedByApp when delete is clicked', () => {
      const detectIsUsedByApp = vi.fn()
      renderInMenu(<Operations {...defaultProps} detectIsUsedByApp={detectIsUsedByApp} />)

      fireEvent.click(screen.getByText(/operation\.delete/))
      expect(detectIsUsedByApp).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edge Cases', () => {
    it('should render only edit when both showDelete and showExportPipeline are false', () => {
      renderInMenu(<Operations {...defaultProps} showDelete={false} showExportPipeline={false} />)
      expect(screen.getByText(/operation\.edit/)).toBeInTheDocument()
      expect(screen.queryByText(/exportPipeline/)).not.toBeInTheDocument()
      expect(screen.queryByText(/operation\.delete/)).not.toBeInTheDocument()
    })
  })
})
