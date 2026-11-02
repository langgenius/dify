import { fireEvent, render, screen } from '@testing-library/react'
import Input from '../base/text-input'

describe('Crawl numeric input', () => {
  const createInputProps = (overrides: Partial<Parameters<typeof Input>[0]> = {}) => ({
    value: '',
    onChange: vi.fn(),
    ...overrides,
  })
  // Native input change is used to supply complete numeric strings, including fractional and negative values.
  describe('Number Input Behavior', () => {
    it('should call onChange with parsed integer for number input', () => {
      const onChange = vi.fn()
      const props = createInputProps({ isNumber: true, onChange, value: 0 })

      render(<Input {...props} />)
      const input = screen.getByRole('spinbutton')

      fireEvent.change(input, { target: { value: '42' } })

      expect(onChange).toHaveBeenCalledWith(42)
    })

    it('should call onChange with empty string when input is empty', () => {
      const onChange = vi.fn()
      const props = createInputProps({ isNumber: true, onChange, value: 5 })

      render(<Input {...props} />)
      const input = screen.getByRole('spinbutton')

      fireEvent.change(input, { target: { value: '' } })

      expect(onChange).toHaveBeenCalledWith('')
    })

    it('should clamp negative values to MIN_VALUE (0)', () => {
      const onChange = vi.fn()
      const props = createInputProps({ isNumber: true, onChange, value: 0 })

      render(<Input {...props} />)
      const input = screen.getByRole('spinbutton')

      fireEvent.change(input, { target: { value: '-5' } })

      expect(onChange).toHaveBeenCalledWith(0)
    })

    it('should handle decimal input by parsing as integer', () => {
      const onChange = vi.fn()
      const props = createInputProps({ isNumber: true, onChange, value: 0 })

      render(<Input {...props} />)
      const input = screen.getByRole('spinbutton')

      fireEvent.change(input, { target: { value: '3.7' } })

      expect(onChange).toHaveBeenCalledWith(3)
    })
  })
})
