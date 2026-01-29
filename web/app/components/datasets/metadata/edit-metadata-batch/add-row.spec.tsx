import type { MetadataItemWithEdit } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DataType } from '../types'
import AddRow from './add-row'

type InputCombinedProps = {
  type: DataType
  value: string | number | null
  onChange: (value: string | number) => void
}

type LabelProps = {
  text: string
}

// Mock InputCombined component
vi.mock('./input-combined', () => ({
  default: ({ type, value, onChange }: InputCombinedProps) => (
    <input
      data-testid="input-combined"
      data-type={type}
      value={value || ''}
      onChange={e => onChange(e.target.value)}
    />
  ),
}))

// Mock Label component
vi.mock('./label', () => ({
  default: ({ text }: LabelProps) => <div data-testid="label">{text}</div>,
}))

describe('AddRow', () => {
  const mockPayload: MetadataItemWithEdit = {
    id: 'test-id',
    name: 'test_field',
    type: DataType.string,
    value: 'test value',
  }

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const handleChange = vi.fn()
      const handleRemove = vi.fn()
      const { container } = render(
        <AddRow payload={mockPayload} onChange={handleChange} onRemove={handleRemove} />,
      )
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render label with payload name', () => {
      const handleChange = vi.fn()
      const handleRemove = vi.fn()
      render(
        <AddRow payload={mockPayload} onChange={handleChange} onRemove={handleRemove} />,
      )
      expect(screen.getByTestId('label')).toHaveTextContent('test_field')
    })

    it('should render input combined component', () => {
      const handleChange = vi.fn()
      const handleRemove = vi.fn()
      render(
        <AddRow payload={mockPayload} onChange={handleChange} onRemove={handleRemove} />,
      )
      expect(screen.getByTestId('input-combined')).toBeInTheDocument()
    })

    it('should render remove button icon', () => {
      const handleChange = vi.fn()
      const handleRemove = vi.fn()
      const { container } = render(
        <AddRow payload={mockPayload} onChange={handleChange} onRemove={handleRemove} />,
      )
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should pass correct type to input combined', () => {
      const handleChange = vi.fn()
      const handleRemove = vi.fn()
      render(
        <AddRow payload={mockPayload} onChange={handleChange} onRemove={handleRemove} />,
      )
      expect(screen.getByTestId('input-combined')).toHaveAttribute('data-type', DataType.string)
    })

    it('should pass correct value to input combined', () => {
      const handleChange = vi.fn()
      const handleRemove = vi.fn()
      render(
        <AddRow payload={mockPayload} onChange={handleChange} onRemove={handleRemove} />,
      )
      expect(screen.getByTestId('input-combined')).toHaveValue('test value')
    })
  })

  describe('Props', () => {
    it('should apply custom className', () => {
      const handleChange = vi.fn()
      const handleRemove = vi.fn()
      const { container } = render(
        <AddRow
          payload={mockPayload}
          onChange={handleChange}
          onRemove={handleRemove}
          className="custom-class"
        />,
      )
      expect(container.firstChild).toHaveClass('custom-class')
    })

    it('should have default flex styling', () => {
      const handleChange = vi.fn()
      const handleRemove = vi.fn()
      const { container } = render(
        <AddRow payload={mockPayload} onChange={handleChange} onRemove={handleRemove} />,
      )
      expect(container.firstChild).toHaveClass('flex', 'h-6', 'items-center', 'space-x-0.5')
    })

    it('should handle different data types', () => {
      const handleChange = vi.fn()
      const handleRemove = vi.fn()
      const numberPayload: MetadataItemWithEdit = {
        ...mockPayload,
        type: DataType.number,
        value: 42,
      }
      render(
        <AddRow payload={numberPayload} onChange={handleChange} onRemove={handleRemove} />,
      )
      expect(screen.getByTestId('input-combined')).toHaveAttribute('data-type', DataType.number)
    })
  })

  describe('User Interactions', () => {
    it('should call onChange with updated payload when input changes', () => {
      const handleChange = vi.fn()
      const handleRemove = vi.fn()
      render(
        <AddRow payload={mockPayload} onChange={handleChange} onRemove={handleRemove} />,
      )

      fireEvent.change(screen.getByTestId('input-combined'), { target: { value: 'new value' } })

      expect(handleChange).toHaveBeenCalledWith({
        ...mockPayload,
        value: 'new value',
      })
    })

    it('should call onRemove when remove button is clicked', () => {
      const handleChange = vi.fn()
      const handleRemove = vi.fn()
      const { container } = render(
        <AddRow payload={mockPayload} onChange={handleChange} onRemove={handleRemove} />,
      )

      const removeButton = container.querySelector('.cursor-pointer')
      if (removeButton)
        fireEvent.click(removeButton)

      expect(handleRemove).toHaveBeenCalledTimes(1)
    })

    it('should preserve other payload properties on change', () => {
      const handleChange = vi.fn()
      const handleRemove = vi.fn()
      render(
        <AddRow payload={mockPayload} onChange={handleChange} onRemove={handleRemove} />,
      )

      fireEvent.change(screen.getByTestId('input-combined'), { target: { value: 'updated' } })

      expect(handleChange).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-id',
          name: 'test_field',
          type: DataType.string,
        }),
      )
    })
  })

  describe('Remove Button Styling', () => {
    it('should have hover styling on remove button', () => {
      const handleChange = vi.fn()
      const handleRemove = vi.fn()
      const { container } = render(
        <AddRow payload={mockPayload} onChange={handleChange} onRemove={handleRemove} />,
      )
      const removeButton = container.querySelector('.cursor-pointer')
      expect(removeButton).toHaveClass('hover:bg-state-destructive-hover', 'hover:text-text-destructive')
    })
  })

  describe('Edge Cases', () => {
    it('should handle null value', () => {
      const handleChange = vi.fn()
      const handleRemove = vi.fn()
      const nullPayload: MetadataItemWithEdit = {
        ...mockPayload,
        value: null,
      }
      render(
        <AddRow payload={nullPayload} onChange={handleChange} onRemove={handleRemove} />,
      )
      expect(screen.getByTestId('input-combined')).toBeInTheDocument()
    })

    it('should handle empty string value', () => {
      const handleChange = vi.fn()
      const handleRemove = vi.fn()
      const emptyPayload: MetadataItemWithEdit = {
        ...mockPayload,
        value: '',
      }
      render(
        <AddRow payload={emptyPayload} onChange={handleChange} onRemove={handleRemove} />,
      )
      expect(screen.getByTestId('input-combined')).toHaveValue('')
    })

    it('should handle time type payload', () => {
      const handleChange = vi.fn()
      const handleRemove = vi.fn()
      const timePayload: MetadataItemWithEdit = {
        ...mockPayload,
        type: DataType.time,
        value: 1609459200,
      }
      render(
        <AddRow payload={timePayload} onChange={handleChange} onRemove={handleRemove} />,
      )
      expect(screen.getByTestId('input-combined')).toHaveAttribute('data-type', DataType.time)
    })

    it('should handle multiple onRemove calls', () => {
      const handleChange = vi.fn()
      const handleRemove = vi.fn()
      const { container } = render(
        <AddRow payload={mockPayload} onChange={handleChange} onRemove={handleRemove} />,
      )

      const removeButton = container.querySelector('.cursor-pointer')
      if (removeButton) {
        fireEvent.click(removeButton)
        fireEvent.click(removeButton)
        fireEvent.click(removeButton)
      }

      expect(handleRemove).toHaveBeenCalledTimes(3)
    })
  })
})
