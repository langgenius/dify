import { fireEvent, render, screen } from '@testing-library/react'
import { InputNumber } from './index'

const getElementReactProps = (element: HTMLElement) => {
  const reactPropsKey = Object.getOwnPropertyNames(element).find(key => key.startsWith('__reactProps$'))
  if (!reactPropsKey)
    throw new Error('Unable to find React props on element')

  return (element as unknown as Record<string, unknown>)[reactPropsKey] as {
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
    onClick?: () => void
  }
}

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

  it('handles increment button click', () => {
    render(<InputNumber {...defaultProps} value={5} />)
    const incrementBtn = screen.getByRole('button', { name: /increment/i })

    fireEvent.click(incrementBtn)
    expect(defaultProps.onChange).toHaveBeenCalledWith(6)
  })

  it('handles decrement button click', () => {
    render(<InputNumber {...defaultProps} value={5} />)
    const decrementBtn = screen.getByRole('button', { name: /decrement/i })

    fireEvent.click(decrementBtn)
    expect(defaultProps.onChange).toHaveBeenCalledWith(4)
  })

  it('respects max value constraint', () => {
    render(<InputNumber {...defaultProps} value={10} max={10} />)
    const incrementBtn = screen.getByRole('button', { name: /increment/i })

    fireEvent.click(incrementBtn)
    expect(defaultProps.onChange).not.toHaveBeenCalled()
  })

  it('respects min value constraint', () => {
    render(<InputNumber {...defaultProps} value={0} min={0} />)
    const decrementBtn = screen.getByRole('button', { name: /decrement/i })

    fireEvent.click(decrementBtn)
    expect(defaultProps.onChange).not.toHaveBeenCalled()
  })

  it('handles direct input changes', () => {
    render(<InputNumber {...defaultProps} />)
    const input = screen.getByRole('spinbutton')

    fireEvent.change(input, { target: { value: '42' } })
    expect(defaultProps.onChange).toHaveBeenCalledWith(42)
  })

  it('handles empty input', () => {
    render(<InputNumber {...defaultProps} value={1} />)
    const input = screen.getByRole('spinbutton')

    fireEvent.change(input, { target: { value: '' } })
    expect(defaultProps.onChange).toHaveBeenCalledWith(0)
  })

  it('handles invalid input', () => {
    render(<InputNumber {...defaultProps} />)
    const input = screen.getByRole('spinbutton')

    fireEvent.change(input, { target: { value: 'abc' } })
    expect(defaultProps.onChange).toHaveBeenCalledWith(0)
  })

  it('does not call onChange when parsed value is NaN', () => {
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} />)
    const input = screen.getByRole('spinbutton') as HTMLInputElement

    const changeEvent = { target: { value: 'not-a-number' } } as React.ChangeEvent<HTMLInputElement>
    getElementReactProps(input).onChange?.(changeEvent)

    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not call onChange when direct input exceeds range', () => {
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} max={10} min={0} />)
    const input = screen.getByRole('spinbutton')

    fireEvent.change(input, { target: { value: '11' } })

    expect(onChange).not.toHaveBeenCalled()
  })

  it('uses default value when increment and decrement are clicked without value prop', () => {
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} defaultValue={7} />)

    fireEvent.click(screen.getByRole('button', { name: /increment/i }))
    fireEvent.click(screen.getByRole('button', { name: /decrement/i }))

    expect(onChange).toHaveBeenNthCalledWith(1, 7)
    expect(onChange).toHaveBeenNthCalledWith(2, 7)
  })

  it('falls back to zero when controls are used without value and defaultValue', () => {
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /increment/i }))
    fireEvent.click(screen.getByRole('button', { name: /decrement/i }))

    expect(onChange).toHaveBeenNthCalledWith(1, 0)
    expect(onChange).toHaveBeenNthCalledWith(2, 0)
  })

  it('displays unit when provided', () => {
    const unit = 'px'
    render(<InputNumber {...defaultProps} unit={unit} />)
    expect(screen.getByText(unit)).toBeInTheDocument()
  })

  it('disables controls when disabled prop is true', () => {
    render(<InputNumber {...defaultProps} disabled />)
    const input = screen.getByRole('spinbutton')
    const incrementBtn = screen.getByRole('button', { name: /increment/i })
    const decrementBtn = screen.getByRole('button', { name: /decrement/i })

    expect(input).toBeDisabled()
    expect(incrementBtn).toBeDisabled()
    expect(decrementBtn).toBeDisabled()
  })

  it('does not change value when disabled handlers are triggered directly', () => {
    const onChange = vi.fn()
    render(<InputNumber onChange={onChange} disabled value={5} />)

    const incrementBtn = screen.getByRole('button', { name: /increment/i })
    const decrementBtn = screen.getByRole('button', { name: /decrement/i })

    getElementReactProps(incrementBtn).onClick?.()
    getElementReactProps(decrementBtn).onClick?.()

    expect(onChange).not.toHaveBeenCalled()
  })

  it('applies large-size classes for control buttons', () => {
    render(<InputNumber {...defaultProps} size="large" />)
    const incrementBtn = screen.getByRole('button', { name: /increment/i })
    const decrementBtn = screen.getByRole('button', { name: /decrement/i })

    expect(incrementBtn).toHaveClass('pt-1.5')
    expect(decrementBtn).toHaveClass('pb-1.5')
  })
})
