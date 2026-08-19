import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
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

// Regression: dify issue 39592 — in a narrow card the number inputs collapsed
// to a 32px, unusable sliver. The fix reflows on the container (a
// @container/chunkfields ancestor, see general-chunking-options): below 552px
// each field stacks and is capped at max-w-[288px] so the input reads as a form
// field; at/above 552px it restores flex-1 (three across, pixel-identical to
// stock). The input keeps a min-width floor as the belt against re-collapse.
// jsdom has no layout engine, so we cannot assert pixel widths — we assert the
// structural classes. These fail before this change and pass after.
describe('#39592 narrow-container regression (structural)', () => {
  it('gives the MaxLength input a min-width floor so it can never collapse to a sliver', () => {
    render(<MaxLengthInput onChange={vi.fn()} />)
    const input = screen.getByRole('textbox')
    expect(input.className).toContain('min-w-16')
  })

  it('gives the OverlapInput input a min-width floor too', () => {
    render(<OverlapInput onChange={vi.fn()} />)
    const input = screen.getByRole('textbox')
    expect(input.className).toContain('min-w-16')
  })

  it('caps each field width when stacked and restores flex-1 across the 552px container query', () => {
    render(<MaxLengthInput onChange={vi.fn()} />)
    const field = screen.getByRole('textbox').closest('.space-y-2')
    expect(field).not.toBeNull()
    // stacked (default / below threshold): constrained width, no stretch
    expect(field!.className).toContain('max-w-[288px]')
    // three-across (at/above threshold): restore flex-1 and drop the cap
    expect(field!.className).toContain('@min-[552px]/chunkfields:flex-1')
    expect(field!.className).toContain('@min-[552px]/chunkfields:max-w-none')
    // the previous flex-wrap approach is gone
    expect(field!.className).not.toContain('basis-[176px]')
  })
})
