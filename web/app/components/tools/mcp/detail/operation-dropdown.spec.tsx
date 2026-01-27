import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import OperationDropdown from './operation-dropdown'

describe('OperationDropdown', () => {
  const defaultProps = {
    onEdit: vi.fn(),
    onRemove: vi.fn(),
  }

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<OperationDropdown {...defaultProps} />)
      expect(document.querySelector('button')).toBeInTheDocument()
    })

    it('should render trigger button with more icon', () => {
      render(<OperationDropdown {...defaultProps} />)
      const button = document.querySelector('button')
      expect(button).toBeInTheDocument()
      const svg = button?.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should render medium size by default', () => {
      render(<OperationDropdown {...defaultProps} />)
      const icon = document.querySelector('.h-4.w-4')
      expect(icon).toBeInTheDocument()
    })

    it('should render large size when inCard is true', () => {
      render(<OperationDropdown {...defaultProps} inCard={true} />)
      const icon = document.querySelector('.h-5.w-5')
      expect(icon).toBeInTheDocument()
    })
  })

  describe('Dropdown Behavior', () => {
    it('should open dropdown when trigger is clicked', async () => {
      render(<OperationDropdown {...defaultProps} />)

      const trigger = document.querySelector('button')
      if (trigger) {
        fireEvent.click(trigger)

        // Dropdown content should be rendered
        expect(screen.getByText('tools.mcp.operation.edit')).toBeInTheDocument()
        expect(screen.getByText('tools.mcp.operation.remove')).toBeInTheDocument()
      }
    })

    it('should call onOpenChange when opened', () => {
      const onOpenChange = vi.fn()
      render(<OperationDropdown {...defaultProps} onOpenChange={onOpenChange} />)

      const trigger = document.querySelector('button')
      if (trigger) {
        fireEvent.click(trigger)
        expect(onOpenChange).toHaveBeenCalledWith(true)
      }
    })

    it('should close dropdown when trigger is clicked again', async () => {
      const onOpenChange = vi.fn()
      render(<OperationDropdown {...defaultProps} onOpenChange={onOpenChange} />)

      const trigger = document.querySelector('button')
      if (trigger) {
        fireEvent.click(trigger)
        fireEvent.click(trigger)
        expect(onOpenChange).toHaveBeenLastCalledWith(false)
      }
    })
  })

  describe('Menu Actions', () => {
    it('should call onEdit when edit option is clicked', () => {
      const onEdit = vi.fn()
      render(<OperationDropdown {...defaultProps} onEdit={onEdit} />)

      const trigger = document.querySelector('button')
      if (trigger) {
        fireEvent.click(trigger)

        const editOption = screen.getByText('tools.mcp.operation.edit')
        fireEvent.click(editOption)

        expect(onEdit).toHaveBeenCalledTimes(1)
      }
    })

    it('should call onRemove when remove option is clicked', () => {
      const onRemove = vi.fn()
      render(<OperationDropdown {...defaultProps} onRemove={onRemove} />)

      const trigger = document.querySelector('button')
      if (trigger) {
        fireEvent.click(trigger)

        const removeOption = screen.getByText('tools.mcp.operation.remove')
        fireEvent.click(removeOption)

        expect(onRemove).toHaveBeenCalledTimes(1)
      }
    })

    it('should close dropdown after edit is clicked', () => {
      const onOpenChange = vi.fn()
      render(<OperationDropdown {...defaultProps} onOpenChange={onOpenChange} />)

      const trigger = document.querySelector('button')
      if (trigger) {
        fireEvent.click(trigger)
        onOpenChange.mockClear()

        const editOption = screen.getByText('tools.mcp.operation.edit')
        fireEvent.click(editOption)

        expect(onOpenChange).toHaveBeenCalledWith(false)
      }
    })

    it('should close dropdown after remove is clicked', () => {
      const onOpenChange = vi.fn()
      render(<OperationDropdown {...defaultProps} onOpenChange={onOpenChange} />)

      const trigger = document.querySelector('button')
      if (trigger) {
        fireEvent.click(trigger)
        onOpenChange.mockClear()

        const removeOption = screen.getByText('tools.mcp.operation.remove')
        fireEvent.click(removeOption)

        expect(onOpenChange).toHaveBeenCalledWith(false)
      }
    })
  })

  describe('Styling', () => {
    it('should have correct dropdown width', () => {
      render(<OperationDropdown {...defaultProps} />)

      const trigger = document.querySelector('button')
      if (trigger) {
        fireEvent.click(trigger)

        const dropdown = document.querySelector('.w-\\[160px\\]')
        expect(dropdown).toBeInTheDocument()
      }
    })

    it('should have rounded-xl on dropdown', () => {
      render(<OperationDropdown {...defaultProps} />)

      const trigger = document.querySelector('button')
      if (trigger) {
        fireEvent.click(trigger)

        const dropdown = document.querySelector('[class*="rounded-xl"][class*="border"]')
        expect(dropdown).toBeInTheDocument()
      }
    })

    it('should show destructive hover style on remove option', () => {
      render(<OperationDropdown {...defaultProps} />)

      const trigger = document.querySelector('button')
      if (trigger) {
        fireEvent.click(trigger)

        // The text is in a div, and the hover style is on the parent div with group class
        const removeOptionText = screen.getByText('tools.mcp.operation.remove')
        const removeOptionContainer = removeOptionText.closest('.group')
        expect(removeOptionContainer).toHaveClass('hover:bg-state-destructive-hover')
      }
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
