import { fireEvent, render, screen } from '@testing-library/react'
import { InputNumber } from './index'

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('InputNumber Component', () => {
  const defaultProps = {
    onChange: jest.fn(),
  }

  afterEach(() => {
    jest.clearAllMocks()
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
    render(<InputNumber {...defaultProps} value={0} />)
    const input = screen.getByRole('spinbutton')

    fireEvent.change(input, { target: { value: '' } })
    expect(defaultProps.onChange).toHaveBeenCalledWith(undefined)
  })

  it('handles invalid input', () => {
    render(<InputNumber {...defaultProps} />)
    const input = screen.getByRole('spinbutton')

    fireEvent.change(input, { target: { value: 'abc' } })
    expect(defaultProps.onChange).not.toHaveBeenCalled()
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
})
