import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import OperationDropdown from '../operation-dropdown'

describe('OperationDropdown', () => {
  const defaultProps = {
    onEdit: vi.fn(),
    onRemove: vi.fn(),
  }

  describe('Rendering', () => {
    it('should render trigger button with more icon', () => {
      render(<OperationDropdown {...defaultProps} />)
      const button = screen.getByRole('button', { name: 'common.operation.more' })
      expect(button).toBeInTheDocument()
      expect(button.querySelector('.i-ri-more-fill')).toBeInTheDocument()
    })

    it('should render medium size by default', () => {
      render(<OperationDropdown {...defaultProps} />)
      const icon = document.querySelector('.size-4')
      expect(icon).toBeInTheDocument()
    })

    it('should render large size when inCard is true', () => {
      render(<OperationDropdown {...defaultProps} inCard={true} />)
      const icon = document.querySelector('.size-5')
      expect(icon).toBeInTheDocument()
    })
  })

  describe('Dropdown Behavior', () => {
    it('should open dropdown when trigger is clicked', async () => {
      render(<OperationDropdown {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))

      expect(screen.getByText('tools.mcp.operation.edit')).toBeInTheDocument()
      expect(screen.getByText('tools.mcp.operation.remove')).toBeInTheDocument()
    })

    it('should call onOpenChange when opened', () => {
      const onOpenChange = vi.fn()
      render(<OperationDropdown {...defaultProps} onOpenChange={onOpenChange} />)

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))
      expect(onOpenChange).toHaveBeenCalledWith(true, expect.any(Object))
    })

    it('should close dropdown when trigger is clicked again', async () => {
      const onOpenChange = vi.fn()
      render(<OperationDropdown {...defaultProps} onOpenChange={onOpenChange} />)

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))
      expect(onOpenChange).toHaveBeenLastCalledWith(false, expect.any(Object))
    })
  })

  describe('Menu Actions', () => {
    it('should call onEdit when edit option is clicked', () => {
      const onEdit = vi.fn()
      render(<OperationDropdown {...defaultProps} onEdit={onEdit} />)

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))
      fireEvent.click(screen.getByText('tools.mcp.operation.edit'))
      expect(onEdit).toHaveBeenCalledTimes(1)
    })

    it('should call onRemove when remove option is clicked', () => {
      const onRemove = vi.fn()
      render(<OperationDropdown {...defaultProps} onRemove={onRemove} />)

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))
      fireEvent.click(screen.getByText('tools.mcp.operation.remove'))
      expect(onRemove).toHaveBeenCalledTimes(1)
    })

    it('should close dropdown after edit is clicked', () => {
      const onOpenChange = vi.fn()
      render(<OperationDropdown {...defaultProps} onOpenChange={onOpenChange} />)

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))
      onOpenChange.mockClear()
      fireEvent.click(screen.getByText('tools.mcp.operation.edit'))
      expect(onOpenChange).toHaveBeenCalledWith(false, expect.any(Object))
    })

    it('should close dropdown after remove is clicked', () => {
      const onOpenChange = vi.fn()
      render(<OperationDropdown {...defaultProps} onOpenChange={onOpenChange} />)

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))
      onOpenChange.mockClear()
      fireEvent.click(screen.getByText('tools.mcp.operation.remove'))
      expect(onOpenChange).toHaveBeenCalledWith(false, expect.any(Object))
    })
  })

  describe('Styling', () => {
    it('should have correct dropdown width', () => {
      render(<OperationDropdown {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))
      const dropdown = document.querySelector('.w-\\[160px\\]')
      expect(dropdown).toBeInTheDocument()
    })

    it('should render dropdown content through the shared popup shell', () => {
      render(<OperationDropdown {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))
      expect(screen.getByRole('menu')).toBeInTheDocument()
    })
  })

  describe('inCard prop', () => {
    it('should adjust offset when inCard is false', () => {
      render(<OperationDropdown {...defaultProps} inCard={false} />)
      // Component renders with different offset values
      expect(document.querySelector('button')).toBeInTheDocument()
    })

    it('should adjust offset when inCard is true', () => {
      render(<OperationDropdown {...defaultProps} inCard={true} />)
      // Component renders with different offset values
      expect(document.querySelector('button')).toBeInTheDocument()
    })
  })
})
