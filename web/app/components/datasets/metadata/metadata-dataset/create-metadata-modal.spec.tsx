import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DataType } from '../types'
import CreateMetadataModal from './create-metadata-modal'

type PortalProps = {
  children: React.ReactNode
  open: boolean
}

type TriggerProps = {
  children: React.ReactNode
  onClick: () => void
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

// Mock PortalToFollowElem components
vi.mock('../../../base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children, open }: PortalProps) => (
    <div data-testid="portal-wrapper" data-open={open}>{children}</div>
  ),
  PortalToFollowElemTrigger: ({ children, onClick }: TriggerProps) => (
    <div data-testid="portal-trigger" onClick={onClick}>{children}</div>
  ),
  PortalToFollowElemContent: ({ children, className }: ContentProps) => (
    <div data-testid="portal-content" className={className}>{children}</div>
  ),
}))

// Mock CreateContent component
vi.mock('./create-content', () => ({
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
      // Portal wrapper should exist but closed
      expect(screen.getByTestId('portal-wrapper')).toBeInTheDocument()
      expect(screen.getByTestId('portal-wrapper')).toHaveAttribute('data-open', 'false')
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
      expect(screen.getByTestId('portal-wrapper')).toBeInTheDocument()
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
      expect(screen.getByTestId('portal-wrapper')).toBeInTheDocument()
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

      fireEvent.click(screen.getByTestId('portal-trigger'))

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

      expect(screen.getByTestId('portal-wrapper')).toHaveAttribute('data-open', 'false')

      rerender(
        <CreateMetadataModal
          open={true}
          setOpen={vi.fn()}
          trigger={mockTrigger}
          onSave={vi.fn()}
        />,
      )

      expect(screen.getByTestId('portal-wrapper')).toHaveAttribute('data-open', 'true')
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
