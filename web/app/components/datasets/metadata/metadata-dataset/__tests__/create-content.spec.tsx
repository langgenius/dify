import type { Props as CreateContentProps } from '../create-content'
import { Popover } from '@langgenius/dify-ui/popover'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DataType } from '../../types'
import CreateContent from '../create-content'

const renderCreateContent = (props: CreateContentProps) => {
  return render(
    <Popover open>
      <CreateContent {...props} />
    </Popover>,
  )
}

describe('CreateContent', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const handleSave = vi.fn()
      renderCreateContent({ onSave: handleSave })
      expect(screen.getByText('dataset.metadata.createMetadata.title')).toBeInTheDocument()
    })

    it('should render modal title', () => {
      const handleSave = vi.fn()
      renderCreateContent({ onSave: handleSave })
      expect(screen.getByText('dataset.metadata.createMetadata.title')).toBeInTheDocument()
    })

    it('should render type selection options', () => {
      const handleSave = vi.fn()
      renderCreateContent({ onSave: handleSave })
      expect(screen.getByText('String')).toBeInTheDocument()
      expect(screen.getByText('Number')).toBeInTheDocument()
      expect(screen.getByText('Time')).toBeInTheDocument()
    })

    it('should render name input field', () => {
      const handleSave = vi.fn()
      renderCreateContent({ onSave: handleSave })
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should render confirm button', () => {
      const handleSave = vi.fn()
      renderCreateContent({ onSave: handleSave })
      expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeInTheDocument()
    })

    it('should render close button', () => {
      const handleSave = vi.fn()
      renderCreateContent({ onSave: handleSave })
      expect(screen.getByRole('button', { name: 'common.operation.close' })).toBeInTheDocument()
    })
  })

  describe('Type Selection', () => {
    it('should save string type by default', () => {
      const handleSave = vi.fn()
      renderCreateContent({ onSave: handleSave })

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(handleSave).toHaveBeenCalledWith({
        type: DataType.string,
        name: '',
      })
    })

    it('should save number type when number is clicked', () => {
      const handleSave = vi.fn()
      renderCreateContent({ onSave: handleSave })

      fireEvent.click(screen.getByText('Number'))
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(handleSave).toHaveBeenCalledWith({
        type: DataType.number,
        name: '',
      })
    })

    it('should save time type when time is clicked', () => {
      const handleSave = vi.fn()
      renderCreateContent({ onSave: handleSave })

      fireEvent.click(screen.getByText('Time'))
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(handleSave).toHaveBeenCalledWith({
        type: DataType.time,
        name: '',
      })
    })

    it('should use the latest selected type when type changes', () => {
      const handleSave = vi.fn()
      renderCreateContent({ onSave: handleSave })

      fireEvent.click(screen.getByText('Number'))
      fireEvent.click(screen.getByText('Time'))
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(handleSave).toHaveBeenCalledWith({
        type: DataType.time,
        name: '',
      })
    })
  })

  describe('Name Input', () => {
    it('should update name when typing', () => {
      const handleSave = vi.fn()
      renderCreateContent({ onSave: handleSave })

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'new_field' } })

      expect(input).toHaveValue('new_field')
    })

    it('should start with empty name', () => {
      const handleSave = vi.fn()
      renderCreateContent({ onSave: handleSave })

      expect(screen.getByRole('textbox')).toHaveValue('')
    })
  })

  describe('User Interactions', () => {
    it('should call onSave with type and name when confirmed', () => {
      const handleSave = vi.fn()
      renderCreateContent({ onSave: handleSave })

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'test_field' } })
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(handleSave).toHaveBeenCalledWith({
        type: DataType.string,
        name: 'test_field',
      })
    })

    it('should call onSave with correct type after changing type', () => {
      const handleSave = vi.fn()
      renderCreateContent({ onSave: handleSave })

      fireEvent.click(screen.getByText('Number'))
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'num_field' } })
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(handleSave).toHaveBeenCalledWith({
        type: DataType.number,
        name: 'num_field',
      })
    })

    it('should call onClose when close button is clicked', () => {
      const handleSave = vi.fn()
      const handleClose = vi.fn()
      renderCreateContent({ onSave: handleSave, onClose: handleClose })

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.close' }))

      expect(handleClose).toHaveBeenCalled()
    })
  })

  describe('Back Button', () => {
    it('should show back button when hasBack is true', () => {
      const handleSave = vi.fn()
      renderCreateContent({ onSave: handleSave, hasBack: true })

      expect(screen.getByRole('button', { name: /dataset\.metadata\.createMetadata\.back/ })).toBeInTheDocument()
    })

    it('should not show back button when hasBack is false', () => {
      const handleSave = vi.fn()
      renderCreateContent({ onSave: handleSave, hasBack: false })

      expect(screen.queryByRole('button', { name: /dataset\.metadata\.createMetadata\.back/ })).not.toBeInTheDocument()
    })

    it('should call onBack when back button is clicked', () => {
      const handleSave = vi.fn()
      const handleBack = vi.fn()
      renderCreateContent({ onSave: handleSave, hasBack: true, onBack: handleBack })

      fireEvent.click(screen.getByRole('button', { name: /dataset\.metadata\.createMetadata\.back/ }))

      expect(handleBack).toHaveBeenCalled()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty name submission', () => {
      const handleSave = vi.fn()
      renderCreateContent({ onSave: handleSave })

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(handleSave).toHaveBeenCalledWith({
        type: DataType.string,
        name: '',
      })
    })

    it('should handle type cycling', () => {
      const handleSave = vi.fn()
      renderCreateContent({ onSave: handleSave })

      // Cycle through all types
      fireEvent.click(screen.getByText('Number'))
      fireEvent.click(screen.getByText('Time'))
      fireEvent.click(screen.getByText('String'))
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(handleSave).toHaveBeenCalledWith({
        type: DataType.string,
        name: '',
      })
    })

    it('should handle special characters in name', () => {
      const handleSave = vi.fn()
      renderCreateContent({ onSave: handleSave })

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'test_field_123' } })

      expect(input).toHaveValue('test_field_123')
    })
  })
})
