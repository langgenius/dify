import type { MetadataItemWithEdit } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DataType, UpdateType } from '../types'
import EditMetadatabatchItem from './edit-row'

type InputCombinedProps = {
  type: DataType
  value: string | number | null
  onChange: (value: string | number) => void
  readOnly?: boolean
}

type MultipleValueInputProps = {
  onClear: () => void
  readOnly?: boolean
}

type LabelProps = {
  text: string
  isDeleted?: boolean
}

type EditedBeaconProps = {
  onReset: () => void
}

// Mock InputCombined component
vi.mock('./input-combined', () => ({
  default: ({ type, value, onChange, readOnly }: InputCombinedProps) => (
    <input
      data-testid="input-combined"
      data-type={type}
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      readOnly={readOnly}
    />
  ),
}))

// Mock InputHasSetMultipleValue component
vi.mock('./input-has-set-multiple-value', () => ({
  default: ({ onClear, readOnly }: MultipleValueInputProps) => (
    <div data-testid="multiple-value-input" data-readonly={readOnly}>
      <button data-testid="clear-multiple" onClick={onClear}>Clear Multiple</button>
    </div>
  ),
}))

// Mock Label component
vi.mock('./label', () => ({
  default: ({ text, isDeleted }: LabelProps) => (
    <div data-testid="label" data-deleted={isDeleted}>{text}</div>
  ),
}))

// Mock EditedBeacon component
vi.mock('./edited-beacon', () => ({
  default: ({ onReset }: EditedBeaconProps) => (
    <button data-testid="edited-beacon" onClick={onReset}>Reset</button>
  ),
}))

describe('EditMetadatabatchItem', () => {
  const mockPayload: MetadataItemWithEdit = {
    id: 'test-id',
    name: 'test_field',
    type: DataType.string,
    value: 'test value',
    isMultipleValue: false,
    isUpdated: false,
  }

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(
        <EditMetadatabatchItem
          payload={mockPayload}
          onChange={vi.fn()}
          onRemove={vi.fn()}
          onReset={vi.fn()}
        />,
      )
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render label with payload name', () => {
      render(
        <EditMetadatabatchItem
          payload={mockPayload}
          onChange={vi.fn()}
          onRemove={vi.fn()}
          onReset={vi.fn()}
        />,
      )
      expect(screen.getByTestId('label')).toHaveTextContent('test_field')
    })

    it('should render input combined for single value', () => {
      render(
        <EditMetadatabatchItem
          payload={mockPayload}
          onChange={vi.fn()}
          onRemove={vi.fn()}
          onReset={vi.fn()}
        />,
      )
      expect(screen.getByTestId('input-combined')).toBeInTheDocument()
    })

    it('should render multiple value input when isMultipleValue is true', () => {
      const multiplePayload: MetadataItemWithEdit = {
        ...mockPayload,
        isMultipleValue: true,
      }
      render(
        <EditMetadatabatchItem
          payload={multiplePayload}
          onChange={vi.fn()}
          onRemove={vi.fn()}
          onReset={vi.fn()}
        />,
      )
      expect(screen.getByTestId('multiple-value-input')).toBeInTheDocument()
    })

    it('should render delete button icon', () => {
      const { container } = render(
        <EditMetadatabatchItem
          payload={mockPayload}
          onChange={vi.fn()}
          onRemove={vi.fn()}
          onReset={vi.fn()}
        />,
      )
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })
  })

  describe('Updated State', () => {
    it('should show edited beacon when isUpdated is true', () => {
      const updatedPayload: MetadataItemWithEdit = {
        ...mockPayload,
        isUpdated: true,
      }
      render(
        <EditMetadatabatchItem
          payload={updatedPayload}
          onChange={vi.fn()}
          onRemove={vi.fn()}
          onReset={vi.fn()}
        />,
      )
      expect(screen.getByTestId('edited-beacon')).toBeInTheDocument()
    })

    it('should not show edited beacon when isUpdated is false', () => {
      render(
        <EditMetadatabatchItem
          payload={mockPayload}
          onChange={vi.fn()}
          onRemove={vi.fn()}
          onReset={vi.fn()}
        />,
      )
      expect(screen.queryByTestId('edited-beacon')).not.toBeInTheDocument()
    })
  })

  describe('Deleted State', () => {
    it('should pass isDeleted to label when updateType is delete', () => {
      const deletedPayload: MetadataItemWithEdit = {
        ...mockPayload,
        updateType: UpdateType.delete,
      }
      render(
        <EditMetadatabatchItem
          payload={deletedPayload}
          onChange={vi.fn()}
          onRemove={vi.fn()}
          onReset={vi.fn()}
        />,
      )
      expect(screen.getByTestId('label')).toHaveAttribute('data-deleted', 'true')
    })

    it('should set readOnly on input when deleted', () => {
      const deletedPayload: MetadataItemWithEdit = {
        ...mockPayload,
        updateType: UpdateType.delete,
      }
      render(
        <EditMetadatabatchItem
          payload={deletedPayload}
          onChange={vi.fn()}
          onRemove={vi.fn()}
          onReset={vi.fn()}
        />,
      )
      expect(screen.getByTestId('input-combined')).toHaveAttribute('readonly')
    })

    it('should have destructive styling on delete button when deleted', () => {
      const deletedPayload: MetadataItemWithEdit = {
        ...mockPayload,
        updateType: UpdateType.delete,
      }
      const { container } = render(
        <EditMetadatabatchItem
          payload={deletedPayload}
          onChange={vi.fn()}
          onRemove={vi.fn()}
          onReset={vi.fn()}
        />,
      )
      const deleteButton = container.querySelector('.bg-state-destructive-hover')
      expect(deleteButton).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onChange with updated payload when input changes', () => {
      const handleChange = vi.fn()
      render(
        <EditMetadatabatchItem
          payload={mockPayload}
          onChange={handleChange}
          onRemove={vi.fn()}
          onReset={vi.fn()}
        />,
      )

      fireEvent.change(screen.getByTestId('input-combined'), { target: { value: 'new value' } })

      expect(handleChange).toHaveBeenCalledWith(
        expect.objectContaining({
          ...mockPayload,
          value: 'new value',
        }),
      )
    })

    it('should call onRemove with id when delete button is clicked', () => {
      const handleRemove = vi.fn()
      const { container } = render(
        <EditMetadatabatchItem
          payload={mockPayload}
          onChange={vi.fn()}
          onRemove={handleRemove}
          onReset={vi.fn()}
        />,
      )

      const deleteButton = container.querySelector('.cursor-pointer')
      if (deleteButton)
        fireEvent.click(deleteButton)

      expect(handleRemove).toHaveBeenCalledWith('test-id')
    })

    it('should call onReset with id when reset beacon is clicked', () => {
      const handleReset = vi.fn()
      const updatedPayload: MetadataItemWithEdit = {
        ...mockPayload,
        isUpdated: true,
      }
      render(
        <EditMetadatabatchItem
          payload={updatedPayload}
          onChange={vi.fn()}
          onRemove={vi.fn()}
          onReset={handleReset}
        />,
      )

      fireEvent.click(screen.getByTestId('edited-beacon'))

      expect(handleReset).toHaveBeenCalledWith('test-id')
    })

    it('should call onChange to clear multiple value', () => {
      const handleChange = vi.fn()
      const multiplePayload: MetadataItemWithEdit = {
        ...mockPayload,
        isMultipleValue: true,
      }
      render(
        <EditMetadatabatchItem
          payload={multiplePayload}
          onChange={handleChange}
          onRemove={vi.fn()}
          onReset={vi.fn()}
        />,
      )

      fireEvent.click(screen.getByTestId('clear-multiple'))

      expect(handleChange).toHaveBeenCalledWith(
        expect.objectContaining({
          value: null,
          isMultipleValue: false,
        }),
      )
    })
  })

  describe('Multiple Value State', () => {
    it('should render multiple value input when isMultipleValue is true', () => {
      const multiplePayload: MetadataItemWithEdit = {
        ...mockPayload,
        isMultipleValue: true,
      }
      render(
        <EditMetadatabatchItem
          payload={multiplePayload}
          onChange={vi.fn()}
          onRemove={vi.fn()}
          onReset={vi.fn()}
        />,
      )
      expect(screen.getByTestId('multiple-value-input')).toBeInTheDocument()
      expect(screen.queryByTestId('input-combined')).not.toBeInTheDocument()
    })

    it('should pass readOnly to multiple value input when deleted', () => {
      const multipleDeletedPayload: MetadataItemWithEdit = {
        ...mockPayload,
        isMultipleValue: true,
        updateType: UpdateType.delete,
      }
      render(
        <EditMetadatabatchItem
          payload={multipleDeletedPayload}
          onChange={vi.fn()}
          onRemove={vi.fn()}
          onReset={vi.fn()}
        />,
      )
      expect(screen.getByTestId('multiple-value-input')).toHaveAttribute('data-readonly', 'true')
    })
  })

  describe('Edge Cases', () => {
    it('should handle payload with number type', () => {
      const numberPayload: MetadataItemWithEdit = {
        ...mockPayload,
        type: DataType.number,
        value: 42,
      }
      render(
        <EditMetadatabatchItem
          payload={numberPayload}
          onChange={vi.fn()}
          onRemove={vi.fn()}
          onReset={vi.fn()}
        />,
      )
      expect(screen.getByTestId('input-combined')).toHaveAttribute('data-type', DataType.number)
    })

    it('should handle payload with time type', () => {
      const timePayload: MetadataItemWithEdit = {
        ...mockPayload,
        type: DataType.time,
        value: 1609459200,
      }
      render(
        <EditMetadatabatchItem
          payload={timePayload}
          onChange={vi.fn()}
          onRemove={vi.fn()}
          onReset={vi.fn()}
        />,
      )
      expect(screen.getByTestId('input-combined')).toHaveAttribute('data-type', DataType.time)
    })

    it('should handle null value', () => {
      const nullPayload: MetadataItemWithEdit = {
        ...mockPayload,
        value: null,
      }
      render(
        <EditMetadatabatchItem
          payload={nullPayload}
          onChange={vi.fn()}
          onRemove={vi.fn()}
          onReset={vi.fn()}
        />,
      )
      expect(screen.getByTestId('input-combined')).toBeInTheDocument()
    })
  })
})
