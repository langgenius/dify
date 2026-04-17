import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DataType } from '../../types'
import CreateMetadataModal from '../create-metadata-modal'

type PopoverProps = {
  children: React.ReactNode
  open: boolean
  onOpenChange?: (open: boolean) => void
}

type TriggerProps = {
  children?: React.ReactNode
  render?: React.ReactNode
}

type ContentProps = {
  children: React.ReactNode
  className?: string
}

type CreateContentProps = {
  onSave: (data: { type: DataType, name: string }) => void
  onClose?: () => void
  onBack?: () => void
  hasBack?: boolean
}

vi.mock('../../../../base/ui/popover', async () => {
  const React = await import('react')
  const PopoverContext = React.createContext<{ open: boolean, onOpenChange?: (open: boolean) => void } | null>(null)

  return {
    Popover: ({ children, open, onOpenChange }: PopoverProps) => (
      <PopoverContext.Provider value={{ open, onOpenChange }}>
        <div data-testid="popover-root" data-open={String(open)}>{children}</div>
      </PopoverContext.Provider>
    ),
    PopoverTrigger: ({ children, render }: TriggerProps) => {
      const context = React.useContext(PopoverContext)
      const content = render ?? children
      const handleClick = () => context?.onOpenChange?.(!context.open)

      if (React.isValidElement(content)) {
        const element = content as React.ReactElement<{ onClick?: () => void }>
        return React.cloneElement(element, { onClick: handleClick })
      }

      return <button type="button" data-testid="popover-trigger" onClick={handleClick}>{content}</button>
    },
    PopoverContent: ({ children, className }: ContentProps) => {
      const context = React.useContext(PopoverContext)
      if (!context?.open)
        return null

      return <div data-testid="popover-content" className={className}>{children}</div>
    },
  }
})

// Mock CreateContent component
vi.mock('../create-content', () => ({
  default: ({ onSave, onClose, onBack, hasBack }: CreateContentProps) => (
    <div data-testid="create-content">
      <span data-testid="has-back">{String(hasBack)}</span>
      <button data-testid="save-btn" onClick={() => onSave({ type: DataType.string, name: 'test' })}>Save</button>
      <button data-testid="close-btn" onClick={onClose}>Close</button>
      {hasBack && <button data-testid="back-btn" onClick={onBack}>Back</button>}
    </div>
  ),
}))

describe('CreateMetadataModal', () => {
  const mockTrigger = <button data-testid="trigger-button">Open Modal</button>

  describe('Rendering', () => {
    it('should render trigger when closed', () => {
      render(
        <CreateMetadataModal
          open={false}
          setOpen={vi.fn()}
          trigger={mockTrigger}
          onSave={vi.fn()}
        />,
      )
      expect(screen.getByTestId('popover-root')).toBeInTheDocument()
      expect(screen.getByTestId('popover-root')).toHaveAttribute('data-open', 'false')
    })

    it('should render content when open', () => {
      render(
        <CreateMetadataModal
          open={true}
          setOpen={vi.fn()}
          trigger={mockTrigger}
          onSave={vi.fn()}
        />,
      )
      expect(screen.getByTestId('popover-root')).toBeInTheDocument()
      expect(screen.getByTestId('create-content')).toBeInTheDocument()
    })

    it('should render trigger element', () => {
      render(
        <CreateMetadataModal
          open={false}
          setOpen={vi.fn()}
          trigger={mockTrigger}
          onSave={vi.fn()}
        />,
      )
      expect(screen.getByTestId('trigger-button')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should pass hasBack to CreateContent', () => {
      render(
        <CreateMetadataModal
          open={true}
          setOpen={vi.fn()}
          trigger={mockTrigger}
          onSave={vi.fn()}
          hasBack
        />,
      )
      expect(screen.getByTestId('has-back')).toHaveTextContent('true')
    })

    it('should pass hasBack=undefined when not provided', () => {
      render(
        <CreateMetadataModal
          open={true}
          setOpen={vi.fn()}
          trigger={mockTrigger}
          onSave={vi.fn()}
        />,
      )
      expect(screen.getByTestId('has-back')).toHaveTextContent('undefined')
    })

    it('should accept custom popupLeft', () => {
      render(
        <CreateMetadataModal
          open={true}
          setOpen={vi.fn()}
          trigger={mockTrigger}
          onSave={vi.fn()}
          popupLeft={50}
        />,
      )
      expect(screen.getByTestId('popover-root')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should toggle open state when trigger is clicked', () => {
      const setOpen = vi.fn()
      render(
        <CreateMetadataModal
          open={false}
          setOpen={setOpen}
          trigger={mockTrigger}
          onSave={vi.fn()}
        />,
      )

      fireEvent.click(screen.getByTestId('trigger-button'))

      expect(setOpen).toHaveBeenCalledWith(true)
    })

    it('should call onSave when save button is clicked', () => {
      const handleSave = vi.fn()
      render(
        <CreateMetadataModal
          open={true}
          setOpen={vi.fn()}
          trigger={mockTrigger}
          onSave={handleSave}
        />,
      )

      fireEvent.click(screen.getByTestId('save-btn'))

      expect(handleSave).toHaveBeenCalledWith({
        type: DataType.string,
        name: 'test',
      })
    })

    it('should close modal when close button is clicked', () => {
      const setOpen = vi.fn()
      render(
        <CreateMetadataModal
          open={true}
          setOpen={setOpen}
          trigger={mockTrigger}
          onSave={vi.fn()}
        />,
      )

      fireEvent.click(screen.getByTestId('close-btn'))

      expect(setOpen).toHaveBeenCalledWith(false)
    })

    it('should close modal when back button is clicked', () => {
      const setOpen = vi.fn()
      render(
        <CreateMetadataModal
          open={true}
          setOpen={setOpen}
          trigger={mockTrigger}
          onSave={vi.fn()}
          hasBack
        />,
      )

      fireEvent.click(screen.getByTestId('back-btn'))

      expect(setOpen).toHaveBeenCalledWith(false)
    })
  })

  describe('Edge Cases', () => {
    it('should handle switching open state', () => {
      const { rerender } = render(
        <CreateMetadataModal
          open={false}
          setOpen={vi.fn()}
          trigger={mockTrigger}
          onSave={vi.fn()}
        />,
      )

      expect(screen.getByTestId('popover-root')).toHaveAttribute('data-open', 'false')

      rerender(
        <CreateMetadataModal
          open={true}
          setOpen={vi.fn()}
          trigger={mockTrigger}
          onSave={vi.fn()}
        />,
      )

      expect(screen.getByTestId('popover-root')).toHaveAttribute('data-open', 'true')
    })

    it('should handle different trigger elements', () => {
      const customTrigger = <div data-testid="custom-trigger">Custom</div>
      render(
        <CreateMetadataModal
          open={false}
          setOpen={vi.fn()}
          trigger={customTrigger}
          onSave={vi.fn()}
        />,
      )

      expect(screen.getByTestId('custom-trigger')).toBeInTheDocument()
    })
  })
})
