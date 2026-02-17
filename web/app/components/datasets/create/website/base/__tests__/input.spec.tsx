import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Input from '../input'

describe('WebsiteInput', () => {
  const onChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render text input by default', () => {
    render(<Input value="hello" onChange={onChange} />)
    const input = screen.getByDisplayValue('hello')
    expect(input).toHaveAttribute('type', 'text')
  })

  it('should render number input when isNumber is true', () => {
    render(<Input value={42} onChange={onChange} isNumber />)
    const input = screen.getByDisplayValue('42')
    expect(input).toHaveAttribute('type', 'number')
  })

  it('should call onChange with string value for text input', () => {
    render(<Input value="" onChange={onChange} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new value' } })
    expect(onChange).toHaveBeenCalledWith('new value')
  })

  it('should call onChange with parsed integer for number input', () => {
    render(<Input value={0} onChange={onChange} isNumber />)
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '10' } })
    expect(onChange).toHaveBeenCalledWith(10)
  })

  it('should call onChange with empty string for NaN number input', () => {
    render(<Input value={0} onChange={onChange} isNumber />)
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: 'abc' } })
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('should clamp negative numbers to 0', () => {
    render(<Input value={0} onChange={onChange} isNumber />)
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '-5' } })
    expect(onChange).toHaveBeenCalledWith(0)
  })

  it('should render placeholder', () => {
    render(<Input value="" onChange={onChange} placeholder="Enter URL" />)
    expect(screen.getByPlaceholderText('Enter URL')).toBeInTheDocument()
  })
})
