import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DataType } from '../../types'
import { CreateMetadataModal } from '../create-metadata-modal'

describe('CreateMetadataModal', () => {
  const mockTrigger = <button>Open Modal</button>

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
      expect(screen.getByRole('button', { name: 'Open Modal' })).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: 'dataset.metadata.createMetadata.name' })).toBeInTheDocument()
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
      expect(screen.getByRole('button', { name: 'Open Modal' })).toBeInTheDocument()
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
      expect(screen.getByRole('button', { name: 'dataset.metadata.createMetadata.back' })).toBeInTheDocument()
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
      expect(screen.queryByRole('button', { name: 'dataset.metadata.createMetadata.back' })).not.toBeInTheDocument()
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
      expect(screen.getByRole('dialog')).toBeInTheDocument()
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

      fireEvent.click(screen.getByRole('button', { name: 'Open Modal' }))

      expect(setOpen).toHaveBeenCalledWith(true, expect.any(Object))
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

      fireEvent.change(screen.getByRole('textbox', { name: 'dataset.metadata.createMetadata.name' }), {
        target: { value: 'test' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

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

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.close' }))

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

      fireEvent.click(screen.getByRole('button', { name: 'dataset.metadata.createMetadata.back' }))

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

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      rerender(
        <CreateMetadataModal
          open={true}
          setOpen={vi.fn()}
          trigger={mockTrigger}
          onSave={vi.fn()}
        />,
      )

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should handle different trigger elements', () => {
      const customTrigger = <button>Custom</button>
      render(
        <CreateMetadataModal
          open={false}
          setOpen={vi.fn()}
          trigger={customTrigger}
          onSave={vi.fn()}
        />,
      )

      expect(screen.getByRole('button', { name: 'Custom' })).toBeInTheDocument()
    })
  })
})
