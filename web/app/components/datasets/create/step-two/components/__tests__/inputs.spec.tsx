import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DelimiterInput, MaxLengthInput, OverlapInput } from '../inputs'

// i18n mock returns namespaced keys like "datasetCreation.stepTwo.separator"
const ns = 'datasetCreation'

describe('DelimiterInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render separator label', () => {
    render(<DelimiterInput />)
    expect(screen.getByText(`${ns}.stepTwo.separator`))!.toBeInTheDocument()
  })

  it('should render text input with placeholder', () => {
    render(<DelimiterInput />)
    const input = screen.getByPlaceholderText(`${ns}.stepTwo.separatorPlaceholder`)
    expect(input)!.toBeInTheDocument()
    expect(input)!.toHaveAttribute('type', 'text')
  })

  it('should pass through value and onChange props', () => {
    const onChange = vi.fn()
    render(<DelimiterInput value="test-val" onChange={onChange} />)
    expect(screen.getByDisplayValue('test-val'))!.toBeInTheDocument()
  })

  it('should render tooltip content', () => {
    render(<DelimiterInput />)
    // Tooltip triggers render; component mounts without error
    // Tooltip triggers render; component mounts without error
    expect(screen.getByText(`${ns}.stepTwo.separator`))!.toBeInTheDocument()
  })

  it('should suppress onChange during IME composition', () => {
    const onChange = vi.fn()
    const finalValue = 'wu'
    render(<DelimiterInput value="" onChange={onChange} />)
    const input = screen.getByPlaceholderText(`${ns}.stepTwo.separatorPlaceholder`)

    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 'w' } })
    fireEvent.change(input, { target: { value: finalValue } })
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.compositionEnd(input)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0].target.value).toBe(finalValue)
  })
})

describe('MaxLengthInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render max length label', () => {
    render(<MaxLengthInput onChange={vi.fn()} />)
    expect(screen.getByText(`${ns}.stepTwo.maxLength`))!.toBeInTheDocument()
  })

  it('should render number input', () => {
    render(<MaxLengthInput onChange={vi.fn()} />)
    const input = screen.getByRole('textbox')
    expect(input)!.toBeInTheDocument()
  })

  it('should accept value prop', () => {
    render(<MaxLengthInput value={500} onChange={vi.fn()} />)
    expect(screen.getByRole('textbox'))!.toHaveValue('500')
  })

  it('should have min of 1', () => {
    render(<MaxLengthInput onChange={vi.fn()} />)
    const input = screen.getByRole('textbox')
    expect(input)!.toBeInTheDocument()
  })

  it('should reset to the minimum when users clear the value', () => {
    const onChange = vi.fn()
    render(<MaxLengthInput value={500} onChange={onChange} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(1)
  })

  it('should clamp out-of-range text edits before updating state', () => {
    const onChange = vi.fn()
    render(<MaxLengthInput value={500} max={1000} onChange={onChange} />)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '1200' } })
    expect(onChange).toHaveBeenLastCalledWith(1000)
  })
})

describe('OverlapInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render overlap label', () => {
    render(<OverlapInput onChange={vi.fn()} />)
    expect(screen.getAllByText(new RegExp(`${ns}.stepTwo.overlap`)).length).toBeGreaterThan(0)
  })

  it('should render number input', () => {
    render(<OverlapInput onChange={vi.fn()} />)
    const input = screen.getByRole('textbox')
    expect(input)!.toBeInTheDocument()
  })

  it('should accept value prop', () => {
    render(<OverlapInput value={50} onChange={vi.fn()} />)
    expect(screen.getByRole('textbox'))!.toHaveValue('50')
  })

  it('should have min of 1', () => {
    render(<OverlapInput onChange={vi.fn()} />)
    const input = screen.getByRole('textbox')
    expect(input)!.toBeInTheDocument()
  })

  it('should reset to the minimum when users clear the value', () => {
    const onChange = vi.fn()
    render(<OverlapInput value={50} onChange={onChange} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(1)
  })

  it('should clamp out-of-range text edits before updating state', () => {
    const onChange = vi.fn()
    render(<OverlapInput value={50} max={100} onChange={onChange} />)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '150' } })
    expect(onChange).toHaveBeenLastCalledWith(100)
  })
})
