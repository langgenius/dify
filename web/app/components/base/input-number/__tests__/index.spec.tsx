import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InputNumber } from '../index'

describe('InputNumber Component', () => {
  const defaultProps = {
    onChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders input with default values', () => {
    render(<InputNumber {...defaultProps} />)
    const input = screen.getByRole('spinbutton')
    expect(input).toBeInTheDocument()
  })

  it('handles increment button click', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} value={5} />)
    const incrementBtn = screen.getByRole('button', { name: /increment/i })

    await user.click(incrementBtn)
    expect(onChange).toHaveBeenCalledWith(6)
  })

  it('handles decrement button click', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} value={5} />)
    const decrementBtn = screen.getByRole('button', { name: /decrement/i })

    await user.click(decrementBtn)
    expect(onChange).toHaveBeenCalledWith(4)
  })

  it('respects max value constraint', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} value={10} max={10} />)
    const incrementBtn = screen.getByRole('button', { name: /increment/i })

    await user.click(incrementBtn)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('respects min value constraint', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} value={0} min={0} />)
    const decrementBtn = screen.getByRole('button', { name: /decrement/i })

    await user.click(decrementBtn)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('handles direct input changes', () => {
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} />)
    const input = screen.getByRole('spinbutton')

    fireEvent.change(input, { target: { value: '42' } })
    expect(onChange).toHaveBeenCalledWith(42)
  })

  it('handles empty input', () => {
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} value={1} />)
    const input = screen.getByRole('spinbutton')

    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(0)
  })

  it('does not call onChange when parsed value is NaN', () => {
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} />)
    const input = screen.getByRole('spinbutton')

    const originalNumber = globalThis.Number
    const numberSpy = vi.spyOn(globalThis, 'Number').mockImplementation((val: unknown) => {
      if (val === '123') {
        return Number.NaN
      }
      return originalNumber(val)
    })

    try {
      fireEvent.change(input, { target: { value: '123' } })
      expect(onChange).not.toHaveBeenCalled()
    }
    finally {
      numberSpy.mockRestore()
    }
  })

  it('does not call onChange when direct input exceeds range', () => {
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} max={10} min={0} />)
    const input = screen.getByRole('spinbutton')

    fireEvent.change(input, { target: { value: '11' } })

    expect(onChange).not.toHaveBeenCalled()
  })

  it('uses default value when increment and decrement are clicked without value prop', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} defaultValue={7} />)

    await user.click(screen.getByRole('button', { name: /increment/i }))
    await user.click(screen.getByRole('button', { name: /decrement/i }))

    expect(onChange).toHaveBeenNthCalledWith(1, 7)
    expect(onChange).toHaveBeenNthCalledWith(2, 7)
  })

  it('falls back to zero when controls are used without value and defaultValue', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: /increment/i }))
    await user.click(screen.getByRole('button', { name: /decrement/i }))

    expect(onChange).toHaveBeenNthCalledWith(1, 0)
    expect(onChange).toHaveBeenNthCalledWith(2, 0)
  })

  it('displays unit when provided', () => {
    const onChange = vi.fn()
    const unit = 'px'
    render(<InputNumber onChange={onChange} unit={unit} />)
    expect(screen.getByText(unit)).toBeInTheDocument()
  })

  it('disables controls when disabled prop is true', () => {
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} disabled />)
    const input = screen.getByRole('spinbutton')
    const incrementBtn = screen.getByRole('button', { name: /increment/i })
    const decrementBtn = screen.getByRole('button', { name: /decrement/i })

    expect(input).toBeDisabled()
    expect(incrementBtn).toBeDisabled()
    expect(decrementBtn).toBeDisabled()
  })

  it('does not change value when disabled controls are clicked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { getByRole } = render(<InputNumber onChange={onChange} disabled value={5} />)

    const incrementBtn = getByRole('button', { name: /increment/i })
    const decrementBtn = getByRole('button', { name: /decrement/i })

    expect(incrementBtn).toBeDisabled()
    expect(decrementBtn).toBeDisabled()

    await user.click(incrementBtn)
    await user.click(decrementBtn)

    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps increment guard when disabled even if button is force-clickable', () => {
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} disabled value={5} />)
    const incrementBtn = screen.getByRole('button', { name: /increment/i })

    // Remove native disabled to force event dispatch and hit component-level guard.
    incrementBtn.removeAttribute('disabled')
    fireEvent.click(incrementBtn)

    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps decrement guard when disabled even if button is force-clickable', () => {
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} disabled value={5} />)
    const decrementBtn = screen.getByRole('button', { name: /decrement/i })

    // Remove native disabled to force event dispatch and hit component-level guard.
    decrementBtn.removeAttribute('disabled')
    fireEvent.click(decrementBtn)

    expect(onChange).not.toHaveBeenCalled()
  })

  it('applies large-size classes for control buttons', () => {
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} size="large" />)
    const incrementBtn = screen.getByRole('button', { name: /increment/i })
    const decrementBtn = screen.getByRole('button', { name: /decrement/i })

    expect(incrementBtn).toHaveClass('pt-1.5')
    expect(decrementBtn).toHaveClass('pb-1.5')
  })

  it('prevents increment beyond max with custom amount', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} value={8} max={10} amount={5} />)
    const incrementBtn = screen.getByRole('button', { name: /increment/i })

    await user.click(incrementBtn)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('prevents decrement below min with custom amount', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} value={2} min={0} amount={5} />)
    const decrementBtn = screen.getByRole('button', { name: /decrement/i })

    await user.click(decrementBtn)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('increments when value with custom amount stays within bounds', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} value={5} max={10} amount={3} />)
    const incrementBtn = screen.getByRole('button', { name: /increment/i })

    await user.click(incrementBtn)
    expect(onChange).toHaveBeenCalledWith(8)
  })

  it('decrements when value with custom amount stays within bounds', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} value={5} min={0} amount={3} />)
    const decrementBtn = screen.getByRole('button', { name: /decrement/i })

    await user.click(decrementBtn)
    expect(onChange).toHaveBeenCalledWith(2)
  })

  it('validates input against max constraint', () => {
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} max={10} />)
    const input = screen.getByRole('spinbutton')

    fireEvent.change(input, { target: { value: '15' } })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('validates input against min constraint', () => {
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} min={5} />)
    const input = screen.getByRole('spinbutton')

    fireEvent.change(input, { target: { value: '2' } })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('accepts input within min and max constraints', () => {
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} min={0} max={100} />)
    const input = screen.getByRole('spinbutton')

    fireEvent.change(input, { target: { value: '50' } })
    expect(onChange).toHaveBeenCalledWith(50)
  })

  it('handles negative min and max values', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} min={-10} max={10} value={0} />)
    const decrementBtn = screen.getByRole('button', { name: /decrement/i })

    await user.click(decrementBtn)
    expect(onChange).toHaveBeenCalledWith(-1)
  })

  it('prevents decrement below negative min', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} min={-10} value={-10} />)
    const decrementBtn = screen.getByRole('button', { name: /decrement/i })

    await user.click(decrementBtn)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('applies wrapClassName to outer div', () => {
    const onChange = vi.fn()
    const wrapClassName = 'custom-wrap-class'
    render(<InputNumber onChange={onChange} wrapClassName={wrapClassName} />)
    const wrapper = screen.getByTestId('input-number-wrapper')
    expect(wrapper).toHaveClass(wrapClassName)
  })

  it('applies controlWrapClassName to control buttons container', () => {
    const onChange = vi.fn()
    const controlWrapClassName = 'custom-control-wrap'
    render(<InputNumber onChange={onChange} controlWrapClassName={controlWrapClassName} />)
    const controlDiv = screen.getByTestId('input-number-controls')
    expect(controlDiv).toHaveClass(controlWrapClassName)
  })

  it('applies controlClassName to individual control buttons', () => {
    const onChange = vi.fn()
    const controlClassName = 'custom-control'
    render(<InputNumber onChange={onChange} controlClassName={controlClassName} />)
    const incrementBtn = screen.getByRole('button', { name: /increment/i })
    const decrementBtn = screen.getByRole('button', { name: /decrement/i })
    expect(incrementBtn).toHaveClass(controlClassName)
    expect(decrementBtn).toHaveClass(controlClassName)
  })

  it('applies regular-size classes for control buttons when size is regular', () => {
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} size="regular" />)
    const incrementBtn = screen.getByRole('button', { name: /increment/i })
    const decrementBtn = screen.getByRole('button', { name: /decrement/i })

    expect(incrementBtn).toHaveClass('pt-1')
    expect(decrementBtn).toHaveClass('pb-1')
  })

  it('handles zero as a valid input', () => {
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} min={-5} max={5} value={1} />)
    const input = screen.getByRole('spinbutton')

    fireEvent.change(input, { target: { value: '0' } })
    expect(onChange).toHaveBeenCalledWith(0)
  })

  it('prevents exact max boundary increment', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} value={10} max={10} />)

    await user.click(screen.getByRole('button', { name: /increment/i }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('prevents exact min boundary decrement', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} value={0} min={0} />)

    await user.click(screen.getByRole('button', { name: /decrement/i }))
    expect(onChange).not.toHaveBeenCalled()
  })
})
