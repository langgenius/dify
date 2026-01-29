import { RiEditLine } from '@remixicon/react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import OperationItem from './operation-item'

describe('OperationItem', () => {
  const defaultProps = {
    Icon: RiEditLine,
    name: 'Edit',
  }

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<OperationItem {...defaultProps} />)
      expect(screen.getByText('Edit')).toBeInTheDocument()
    })

    it('should render the icon', () => {
      const { container } = render(<OperationItem {...defaultProps} />)
      const icon = container.querySelector('svg')
      expect(icon).toBeInTheDocument()
      expect(icon).toHaveClass('size-4', 'text-text-tertiary')
    })

    it('should render the name text', () => {
      render(<OperationItem {...defaultProps} />)
      const nameSpan = screen.getByText('Edit')
      expect(nameSpan).toHaveClass('system-md-regular', 'text-text-secondary')
    })
  })

  describe('Props', () => {
    it('should render different name', () => {
      render(<OperationItem {...defaultProps} name="Delete" />)
      expect(screen.getByText('Delete')).toBeInTheDocument()
    })

    it('should be callable without handleClick', () => {
      render(<OperationItem {...defaultProps} />)
      const item = screen.getByText('Edit').closest('div')
      expect(() => fireEvent.click(item!)).not.toThrow()
    })
  })

  describe('User Interactions', () => {
    it('should call handleClick when clicked', () => {
      const handleClick = vi.fn()
      render(<OperationItem {...defaultProps} handleClick={handleClick} />)

      const item = screen.getByText('Edit').closest('div')
      fireEvent.click(item!)

      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('should prevent default and stop propagation on click', () => {
      const handleClick = vi.fn()
      render(<OperationItem {...defaultProps} handleClick={handleClick} />)

      const item = screen.getByText('Edit').closest('div')
      const clickEvent = new MouseEvent('click', { bubbles: true })
      const preventDefaultSpy = vi.spyOn(clickEvent, 'preventDefault')
      const stopPropagationSpy = vi.spyOn(clickEvent, 'stopPropagation')

      item!.dispatchEvent(clickEvent)

      expect(preventDefaultSpy).toHaveBeenCalled()
      expect(stopPropagationSpy).toHaveBeenCalled()
    })
  })

  describe('Styles', () => {
    it('should have correct container styling', () => {
      render(<OperationItem {...defaultProps} />)
      const item = screen.getByText('Edit').closest('div')
      expect(item).toHaveClass('flex', 'cursor-pointer', 'items-center', 'gap-x-1', 'rounded-lg')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty name', () => {
      render(<OperationItem {...defaultProps} name="" />)
      const container = document.querySelector('.cursor-pointer')
      expect(container).toBeInTheDocument()
    })
  })
})
