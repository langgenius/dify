import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Field from '../field'

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({ popupContent }: { popupContent?: React.ReactNode }) => <div data-testid="tooltip">{popupContent}</div>,
}))

describe('WebsiteField', () => {
  const onChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render label', () => {
    render(<Field label="URL" value="" onChange={onChange} />)
    expect(screen.getByText('URL')).toBeInTheDocument()
  })

  it('should render required asterisk when isRequired', () => {
    render(<Field label="URL" value="" onChange={onChange} isRequired />)
    expect(screen.getByText('*')).toBeInTheDocument()
  })

  it('should not render required asterisk by default', () => {
    render(<Field label="URL" value="" onChange={onChange} />)
    expect(screen.queryByText('*')).not.toBeInTheDocument()
  })

  it('should render tooltip when provided', () => {
    render(<Field label="URL" value="" onChange={onChange} tooltip="Enter full URL" />)
    expect(screen.getByTestId('tooltip')).toBeInTheDocument()
  })

  it('should pass value and onChange to Input', () => {
    render(<Field label="URL" value="https://example.com" onChange={onChange} />)
    expect(screen.getByDisplayValue('https://example.com')).toBeInTheDocument()
  })

  it('should call onChange when input changes', () => {
    render(<Field label="URL" value="" onChange={onChange} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new' } })
    expect(onChange).toHaveBeenCalledWith('new')
  })
})
