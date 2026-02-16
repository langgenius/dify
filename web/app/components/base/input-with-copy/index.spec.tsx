import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { createReactI18nextMock } from '@/test/i18n-mock'
import InputWithCopy from './index'

// Create a controllable mock for useClipboard
const mockCopy = vi.fn()
let mockCopied = false
const mockReset = vi.fn()

vi.mock('foxact/use-clipboard', () => ({
  useClipboard: () => ({
    copy: mockCopy,
    copied: mockCopied,
    reset: mockReset,
  }),
}))

// Mock the i18n hook with custom translations for test assertions
vi.mock('react-i18next', () => createReactI18nextMock({
  'operation.copy': 'Copy',
  'operation.copied': 'Copied',
  'overview.appInfo.embedded.copy': 'Copy',
  'overview.appInfo.embedded.copied': 'Copied',
}))

describe('InputWithCopy component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCopy.mockClear()
    mockReset.mockClear()
    mockCopied = false
  })

  it('renders correctly with default props', () => {
    const mockOnChange = vi.fn()
    render(<InputWithCopy value="test value" onChange={mockOnChange} />)
    const input = screen.getByDisplayValue('test value')
    const copyButton = screen.getByRole('button')
    expect(input).toBeInTheDocument()
    expect(copyButton).toBeInTheDocument()
  })

  it('hides copy button when showCopyButton is false', () => {
    const mockOnChange = vi.fn()
    render(<InputWithCopy value="test value" onChange={mockOnChange} showCopyButton={false} />)
    const input = screen.getByDisplayValue('test value')
    const copyButton = screen.queryByRole('button')
    expect(input).toBeInTheDocument()
    expect(copyButton).not.toBeInTheDocument()
  })

  it('calls copy function with input value when copy button is clicked', () => {
    const mockOnChange = vi.fn()
    render(<InputWithCopy value="test value" onChange={mockOnChange} />)

    const copyButton = screen.getByRole('button')
    fireEvent.click(copyButton)

    expect(mockCopy).toHaveBeenCalledWith('test value')
  })

  it('calls copy function with custom value when copyValue prop is provided', () => {
    const mockOnChange = vi.fn()
    render(<InputWithCopy value="display value" onChange={mockOnChange} copyValue="custom copy value" />)

    const copyButton = screen.getByRole('button')
    fireEvent.click(copyButton)

    expect(mockCopy).toHaveBeenCalledWith('custom copy value')
  })

  it('calls onCopy callback when copy button is clicked', () => {
    const onCopyMock = vi.fn()
    const mockOnChange = vi.fn()
    render(<InputWithCopy value="test value" onChange={mockOnChange} onCopy={onCopyMock} />)

    const copyButton = screen.getByRole('button')
    fireEvent.click(copyButton)

    expect(onCopyMock).toHaveBeenCalledWith('test value')
  })

  it('shows copied state when copied is true', () => {
    mockCopied = true
    const mockOnChange = vi.fn()
    render(<InputWithCopy value="test value" onChange={mockOnChange} />)

    const copyButton = screen.getByRole('button')
    // Hover over the button to trigger tooltip
    fireEvent.mouseEnter(copyButton)

    // The icon should change to filled version when copied
    // We verify the component renders without error in copied state
    expect(copyButton).toBeInTheDocument()
  })

  it('passes through all input props correctly', () => {
    const mockOnChange = vi.fn()
    render(
      <InputWithCopy
        value="test value"
        onChange={mockOnChange}
        placeholder="Custom placeholder"
        disabled
        readOnly
        className="custom-class"
      />,
    )

    const input = screen.getByDisplayValue('test value')
    expect(input).toHaveAttribute('placeholder', 'Custom placeholder')
    expect(input).toBeDisabled()
    expect(input).toHaveAttribute('readonly')
    expect(input).toHaveClass('custom-class')
  })

  it('handles empty value correctly', () => {
    const mockOnChange = vi.fn()
    render(<InputWithCopy value="" onChange={mockOnChange} />)
    const input = screen.getByRole('textbox')
    const copyButton = screen.getByRole('button')

    expect(input).toBeInTheDocument()
    expect(input).toHaveValue('')
    expect(copyButton).toBeInTheDocument()

    // Clicking copy button with empty value should call copy with empty string
    fireEvent.click(copyButton)
    expect(mockCopy).toHaveBeenCalledWith('')
  })

  it('maintains focus on input after copy', () => {
    const mockOnChange = vi.fn()
    render(<InputWithCopy value="test value" onChange={mockOnChange} />)

    const input = screen.getByDisplayValue('test value')
    const copyButton = screen.getByRole('button')

    input.focus()
    expect(input).toHaveFocus()

    fireEvent.click(copyButton)

    // Input should maintain focus after copy
    expect(input).toHaveFocus()
  })
})
