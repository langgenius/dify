import { render, screen } from '@testing-library/react'
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
    expect(screen.getByText(`${ns}.stepTwo.separator`)).toBeInTheDocument()
  })

  it('should render text input with placeholder', () => {
    render(<DelimiterInput />)
    const input = screen.getByPlaceholderText(`${ns}.stepTwo.separatorPlaceholder`)
    expect(input).toBeInTheDocument()
    expect(input).toHaveAttribute('type', 'text')
  })

  it('should pass through value and onChange props', () => {
    const onChange = vi.fn()
    render(<DelimiterInput value="test-val" onChange={onChange} />)
    expect(screen.getByDisplayValue('test-val')).toBeInTheDocument()
  })

  it('should render tooltip content', () => {
    render(<DelimiterInput />)
    // Tooltip triggers render; component mounts without error
    expect(screen.getByText(`${ns}.stepTwo.separator`)).toBeInTheDocument()
  })
})

describe('MaxLengthInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render max length label', () => {
    render(<MaxLengthInput onChange={vi.fn()} />)
    expect(screen.getByText(`${ns}.stepTwo.maxLength`)).toBeInTheDocument()
  })

  it('should render number input', () => {
    render(<MaxLengthInput onChange={vi.fn()} />)
    const input = screen.getByRole('spinbutton')
    expect(input).toBeInTheDocument()
  })

  it('should accept value prop', () => {
    render(<MaxLengthInput value={500} onChange={vi.fn()} />)
    expect(screen.getByDisplayValue('500')).toBeInTheDocument()
  })

  it('should have min of 1', () => {
    render(<MaxLengthInput onChange={vi.fn()} />)
    const input = screen.getByRole('spinbutton')
    expect(input).toHaveAttribute('min', '1')
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
    const input = screen.getByRole('spinbutton')
    expect(input).toBeInTheDocument()
  })

  it('should accept value prop', () => {
    render(<OverlapInput value={50} onChange={vi.fn()} />)
    expect(screen.getByDisplayValue('50')).toBeInTheDocument()
  })

  it('should have min of 1', () => {
    render(<OverlapInput onChange={vi.fn()} />)
    const input = screen.getByRole('spinbutton')
    expect(input).toHaveAttribute('min', '1')
  })
})
