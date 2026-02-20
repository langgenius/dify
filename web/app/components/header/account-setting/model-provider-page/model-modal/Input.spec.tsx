import { fireEvent, render, screen } from '@testing-library/react'
import Input from './Input'

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
  it('should clamp to the min value when the input is below min on blur', () => {
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

  it('should clamp to the max value when the input is above max on blur', () => {
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

  it('should keep the value when it is within the min/max range on blur', () => {
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
})
