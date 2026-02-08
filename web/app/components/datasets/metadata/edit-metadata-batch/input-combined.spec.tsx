import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DataType } from '../types'
import InputCombined from './input-combined'

type DatePickerProps = {
  value: number | null
  onChange: (value: number) => void
  className?: string
}

// Mock the base date-picker component
vi.mock('../base/date-picker', () => ({
  default: ({ value, onChange, className }: DatePickerProps) => (
    <div data-testid="date-picker" className={className} onClick={() => onChange(Date.now())}>
      {value || 'Pick date'}
    </div>
  ),
}))

describe('InputCombined', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const handleChange = vi.fn()
      const { container } = render(
        <InputCombined type={DataType.string} value="" onChange={handleChange} />,
      )
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render text input for string type', () => {
      const handleChange = vi.fn()
      render(
        <InputCombined type={DataType.string} value="test" onChange={handleChange} />,
      )
      const input = screen.getByDisplayValue('test')
      expect(input).toBeInTheDocument()
      expect(input.tagName.toLowerCase()).toBe('input')
    })

    it('should render number input for number type', () => {
      const handleChange = vi.fn()
      render(
        <InputCombined type={DataType.number} value={42} onChange={handleChange} />,
      )
      const input = screen.getByDisplayValue('42')
      expect(input).toBeInTheDocument()
    })

    it('should render date picker for time type', () => {
      const handleChange = vi.fn()
      render(
        <InputCombined type={DataType.time} value={Date.now()} onChange={handleChange} />,
      )
      expect(screen.getByTestId('date-picker')).toBeInTheDocument()
    })
  })

  describe('String Input', () => {
    it('should call onChange with input value for string type', () => {
      const handleChange = vi.fn()
      render(
        <InputCombined type={DataType.string} value="" onChange={handleChange} />,
      )

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'new value' } })

      expect(handleChange).toHaveBeenCalledWith('new value')
    })

    it('should display current value for string type', () => {
      const handleChange = vi.fn()
      render(
        <InputCombined type={DataType.string} value="existing value" onChange={handleChange} />,
      )

      expect(screen.getByDisplayValue('existing value')).toBeInTheDocument()
    })

    it('should apply readOnly prop to string input', () => {
      const handleChange = vi.fn()
      render(
        <InputCombined type={DataType.string} value="test" onChange={handleChange} readOnly />,
      )

      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('readonly')
    })
  })

  describe('Number Input', () => {
    it('should call onChange with number value for number type', () => {
      const handleChange = vi.fn()
      render(
        <InputCombined type={DataType.number} value={0} onChange={handleChange} />,
      )

      const input = screen.getByRole('spinbutton')
      fireEvent.change(input, { target: { value: '123' } })

      expect(handleChange).toHaveBeenCalled()
    })

    it('should display current value for number type', () => {
      const handleChange = vi.fn()
      render(
        <InputCombined type={DataType.number} value={999} onChange={handleChange} />,
      )

      expect(screen.getByDisplayValue('999')).toBeInTheDocument()
    })

    it('should apply readOnly prop to number input', () => {
      const handleChange = vi.fn()
      render(
        <InputCombined type={DataType.number} value={42} onChange={handleChange} readOnly />,
      )

      const input = screen.getByRole('spinbutton')
      expect(input).toHaveAttribute('readonly')
    })
  })

  describe('Time/Date Input', () => {
    it('should render date picker for time type', () => {
      const handleChange = vi.fn()
      render(
        <InputCombined type={DataType.time} value={1234567890} onChange={handleChange} />,
      )

      expect(screen.getByTestId('date-picker')).toBeInTheDocument()
    })

    it('should call onChange when date is selected', () => {
      const handleChange = vi.fn()
      render(
        <InputCombined type={DataType.time} value={null} onChange={handleChange} />,
      )

      fireEvent.click(screen.getByTestId('date-picker'))
      expect(handleChange).toHaveBeenCalled()
    })
  })

  describe('Props', () => {
    it('should apply custom className', () => {
      const handleChange = vi.fn()
      const { container } = render(
        <InputCombined
          type={DataType.string}
          value=""
          onChange={handleChange}
          className="custom-class"
        />,
      )

      // Check that custom class is applied to wrapper
      const wrapper = container.querySelector('.custom-class')
      expect(wrapper).toBeInTheDocument()
    })

    it('should handle null value for string type', () => {
      const handleChange = vi.fn()
      render(
        <InputCombined type={DataType.string} value={null} onChange={handleChange} />,
      )

      const input = screen.getByRole('textbox')
      expect(input).toBeInTheDocument()
    })

    it('should handle undefined value for string type', () => {
      const handleChange = vi.fn()
      render(
        <InputCombined type={DataType.string} value={undefined as unknown as string} onChange={handleChange} />,
      )

      const input = screen.getByRole('textbox')
      expect(input).toBeInTheDocument()
    })

    it('should handle null value for number type', () => {
      const handleChange = vi.fn()
      render(
        <InputCombined type={DataType.number} value={null} onChange={handleChange} />,
      )

      const input = screen.getByRole('spinbutton')
      expect(input).toBeInTheDocument()
    })
  })

  describe('Styling', () => {
    it('should have correct base styling for string input', () => {
      const handleChange = vi.fn()
      render(
        <InputCombined type={DataType.string} value="" onChange={handleChange} />,
      )

      const input = screen.getByRole('textbox')
      expect(input).toHaveClass('h-6', 'grow', 'p-0.5', 'text-xs', 'rounded-md')
    })

    it('should have correct styling for number input', () => {
      const handleChange = vi.fn()
      render(
        <InputCombined type={DataType.number} value={0} onChange={handleChange} />,
      )

      const input = screen.getByRole('spinbutton')
      expect(input).toHaveClass('rounded-l-md')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty string value', () => {
      const handleChange = vi.fn()
      render(
        <InputCombined type={DataType.string} value="" onChange={handleChange} />,
      )

      const input = screen.getByRole('textbox')
      expect(input).toHaveValue('')
    })

    it('should handle zero value for number', () => {
      const handleChange = vi.fn()
      render(
        <InputCombined type={DataType.number} value={0} onChange={handleChange} />,
      )

      expect(screen.getByDisplayValue('0')).toBeInTheDocument()
    })

    it('should handle negative number', () => {
      const handleChange = vi.fn()
      render(
        <InputCombined type={DataType.number} value={-100} onChange={handleChange} />,
      )

      expect(screen.getByDisplayValue('-100')).toBeInTheDocument()
    })

    it('should handle special characters in string', () => {
      const handleChange = vi.fn()
      render(
        <InputCombined type={DataType.string} value={'<script>alert("xss")</script>'} onChange={handleChange} />,
      )

      expect(screen.getByDisplayValue('<script>alert("xss")</script>')).toBeInTheDocument()
    })

    it('should handle switching between types', () => {
      const handleChange = vi.fn()
      const { rerender } = render(
        <InputCombined type={DataType.string} value="test" onChange={handleChange} />,
      )

      expect(screen.getByRole('textbox')).toBeInTheDocument()

      rerender(
        <InputCombined type={DataType.number} value={42} onChange={handleChange} />,
      )

      expect(screen.getByRole('spinbutton')).toBeInTheDocument()
    })
  })
})
