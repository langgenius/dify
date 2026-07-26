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
    expect(screen.getByLabelText(`${ns}.stepTwo.separatorTip`))!.toBeInTheDocument()
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
    expect(screen.getByLabelText(`${ns}.stepTwo.overlapTip`))!.toBeInTheDocument()
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

// Regression: langgenius/dify#39592 — below ~1351px viewport (a ~440px card)
// the number inputs collapsed to a 32px, unusable sliver. The input's own
// min-width is the belt to the row's flex-wrap braces (the wrap lives on the
// row in general-chunking-options). jsdom has no layout engine, so we cannot
// assert pixel widths here; we assert the structural classes that prevent the
// collapse. These fail before the fix and pass after.
describe('#39592 narrow-container regression (structural)', () => {
  it('gives the MaxLength input a min-width so it can never collapse to a sliver', () => {
    render(<MaxLengthInput onChange={vi.fn()} />)
    const input = screen.getByRole('textbox')
    expect(input.className).toContain('min-w-[64px]')
  })

  it('gives the OverlapInput input a min-width too', () => {
    render(<OverlapInput onChange={vi.fn()} />)
    const input = screen.getByRole('textbox')
    expect(input.className).toContain('min-w-[64px]')
  })

  it('gives each field a flex-basis (not flex-1) so the row can wrap on container width', () => {
    render(<MaxLengthInput onChange={vi.fn()} />)
    const field = screen.getByRole('textbox').closest('.space-y-2')
    expect(field).not.toBeNull()
    expect(field!.className).toContain('basis-[176px]')
    // must not carry the old flex-1 that forced a single non-wrapping row
    expect(field!.className).not.toContain('flex-1')
  })
})
