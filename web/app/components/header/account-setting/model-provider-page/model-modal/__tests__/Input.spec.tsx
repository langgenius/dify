import { fireEvent, render, screen } from '@testing-library/react'
import Input from '../Input'

describe('Input', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering basics
  it('should render with the provided placeholder and value', () => {
    render(
      <Input
        value="hello"
        placeholder="API Key"
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByPlaceholderText('API Key')).toHaveValue('hello')
  })

  it('should render password inputs without autocomplete attributes', () => {
    render(
      <Input
        type="password"
        placeholder="Secret"
        onChange={vi.fn()}
      />,
    )

    const input = screen.getByPlaceholderText('Secret')

    expect(input).toHaveAttribute('type', 'password')
    expect(input).not.toHaveAttribute('autocomplete')
  })

  // User interaction
  it('should call onChange when the user types', () => {
    const onChange = vi.fn()

    render(
      <Input
        placeholder="API Key"
        onChange={onChange}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('API Key'), { target: { value: 'next' } })

    expect(onChange).toHaveBeenCalledWith('next')
  })

  // Edge cases: min/max enforcement
  it('should clamp to the min value when the input is below min on blur-sm', () => {
    const onChange = vi.fn()

    render(
      <Input
        placeholder="Limit"
        onChange={onChange}
        min={2}
        max={6}
      />,
    )

    const input = screen.getByPlaceholderText('Limit')
    fireEvent.change(input, { target: { value: '1' } })
    fireEvent.blur(input)

    expect(onChange).toHaveBeenLastCalledWith('2')
  })

  it('should clamp to the max value when the input is above max on blur-sm', () => {
    const onChange = vi.fn()

    render(
      <Input
        placeholder="Limit"
        onChange={onChange}
        min={2}
        max={6}
      />,
    )

    const input = screen.getByPlaceholderText('Limit')
    fireEvent.change(input, { target: { value: '8' } })
    fireEvent.blur(input)

    expect(onChange).toHaveBeenLastCalledWith('6')
  })

  it('should keep the value when it is within the min/max range on blur-sm', () => {
    const onChange = vi.fn()

    render(
      <Input
        placeholder="Limit"
        onChange={onChange}
        min={2}
        max={6}
      />,
    )

    const input = screen.getByPlaceholderText('Limit')
    fireEvent.change(input, { target: { value: '4' } })
    fireEvent.blur(input)

    expect(onChange).not.toHaveBeenCalledWith('2')
    expect(onChange).not.toHaveBeenCalledWith('6')
  })

  it('should not clamp when min and max are not provided', () => {
    const onChange = vi.fn()

    render(
      <Input
        placeholder="Free"
        onChange={onChange}
      />,
    )

    const input = screen.getByPlaceholderText('Free')
    fireEvent.change(input, { target: { value: '999' } })
    fireEvent.blur(input)

    // onChange only called from change event, not from blur clamping
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('999')
  })

  it('should show check circle icon when validated is true', () => {
    const { container } = render(
      <Input
        placeholder="Key"
        onChange={vi.fn()}
        validated
      />,
    )

    expect(screen.getByPlaceholderText('Key')).toBeInTheDocument()
    expect(container.querySelector('.absolute.right-2\\.5.top-2\\.5')).toBeInTheDocument()
  })

  it('should not show check circle icon when validated is false', () => {
    const { container } = render(
      <Input
        placeholder="Key"
        onChange={vi.fn()}
        validated={false}
      />,
    )

    expect(screen.getByPlaceholderText('Key')).toBeInTheDocument()
    expect(container.querySelector('.absolute.right-2\\.5.top-2\\.5')).not.toBeInTheDocument()
  })

  it('should apply disabled attribute when disabled prop is true', () => {
    render(
      <Input
        placeholder="Disabled"
        onChange={vi.fn()}
        disabled
      />,
    )

    expect(screen.getByPlaceholderText('Disabled')).toBeDisabled()
  })

  it('should call onFocus when input receives focus', () => {
    const onFocus = vi.fn()

    render(
      <Input
        placeholder="Focus"
        onChange={vi.fn()}
        onFocus={onFocus}
      />,
    )

    fireEvent.focus(screen.getByPlaceholderText('Focus'))
    expect(onFocus).toHaveBeenCalledTimes(1)
  })

  it('should render with custom className', () => {
    render(
      <Input
        placeholder="Styled"
        onChange={vi.fn()}
        className="custom-class"
      />,
    )

    expect(screen.getByPlaceholderText('Styled')).toHaveClass('custom-class')
  })
})
