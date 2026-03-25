import type { IConfigStringProps } from './index'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ConfigString from './index'

const renderConfigString = (props?: Partial<IConfigStringProps>) => {
  const onChange = vi.fn()
  const defaultProps: IConfigStringProps = {
    value: 5,
    maxLength: 10,
    modelId: 'model-id',
    onChange,
  }

  render(<ConfigString {...defaultProps} {...props} />)

  return { onChange }
}

describe('ConfigString', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render numeric input with bounds', () => {
      renderConfigString({ value: 3, maxLength: 8 })

      const input = screen.getByRole('spinbutton')

      expect(input).toHaveValue(3)
      expect(input).toHaveAttribute('min', '1')
      expect(input).toHaveAttribute('max', '8')
    })

    it('should render empty input when value is undefined', () => {
      const { onChange } = renderConfigString({ value: undefined })

      expect(screen.getByRole('spinbutton')).toHaveValue(null)
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('Effect behavior', () => {
    it('should clamp initial value to maxLength when it exceeds limit', async () => {
      const onChange = vi.fn()
      render(
        <ConfigString
          value={15}
          maxLength={10}
          modelId="model-id"
          onChange={onChange}
        />,
      )

      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith(10)
      })
      expect(onChange).toHaveBeenCalledTimes(1)
    })

    it('should clamp when updated prop value exceeds maxLength', async () => {
      const onChange = vi.fn()
      const { rerender } = render(
        <ConfigString
          value={4}
          maxLength={6}
          modelId="model-id"
          onChange={onChange}
        />,
      )

      rerender(
        <ConfigString
          value={9}
          maxLength={6}
          modelId="model-id"
          onChange={onChange}
        />,
      )

      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith(6)
      })
      expect(onChange).toHaveBeenCalledTimes(1)
    })
  })

  describe('User interactions', () => {
    it('should clamp entered value above maxLength', () => {
      const { onChange } = renderConfigString({ maxLength: 7 })

      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '12' } })

      expect(onChange).toHaveBeenCalledWith(7)
    })

    it('should raise value below minimum to one', () => {
      const { onChange } = renderConfigString()

      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '0' } })

      expect(onChange).toHaveBeenCalledWith(1)
    })

    it('should forward parsed value when within bounds', () => {
      const { onChange } = renderConfigString({ maxLength: 9 })

      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '7' } })

      expect(onChange).toHaveBeenCalledWith(7)
    })

    it('should pass through NaN when input is cleared', () => {
      const { onChange } = renderConfigString()

      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' } })

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange.mock.calls[0][0]).toBeNaN()
    })
  })
})
