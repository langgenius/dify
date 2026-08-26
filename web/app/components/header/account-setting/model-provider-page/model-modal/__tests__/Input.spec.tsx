import { fireEvent, render, screen } from '@testing-library/react'
import Input from '../Input'

describe('Input', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not allow password inputs to be autocompleted', () => {
    render(<Input type="password" placeholder="Secret" onChange={vi.fn()} />)

    const input = screen.getByPlaceholderText('Secret')

    expect(input).toHaveAttribute('type', 'password')
    expect(input).not.toHaveAttribute('autocomplete')
  })

  it('reports user input', () => {
    const onChange = vi.fn()

    render(<Input placeholder="API Key" onChange={onChange} />)

    fireEvent.change(screen.getByPlaceholderText('API Key'), { target: { value: 'next' } })

    expect(onChange).toHaveBeenCalledWith('next')
  })

  it('clamps values to the configured range on blur', () => {
    const onChange = vi.fn()

    render(<Input placeholder="Limit" onChange={onChange} min={2} max={6} />)

    const input = screen.getByPlaceholderText('Limit')
    fireEvent.change(input, { target: { value: '1' } })
    fireEvent.blur(input)

    expect(onChange).toHaveBeenLastCalledWith('2')

    fireEvent.change(input, { target: { value: '8' } })
    fireEvent.blur(input)

    expect(onChange).toHaveBeenLastCalledWith('6')
  })
})
