import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import InputWithCopy from './index'

// Create a mock function that we can track using vi.hoisted
const mockCopyToClipboard = vi.hoisted(() => vi.fn(() => true))

// Mock the copy-to-clipboard library
vi.mock('copy-to-clipboard', () => ({
  default: mockCopyToClipboard,
}))

// Mock the i18n hook
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'common.operation.copy': 'Copy',
        'common.operation.copied': 'Copied',
        'appOverview.overview.appInfo.embedded.copy': 'Copy',
        'appOverview.overview.appInfo.embedded.copied': 'Copied',
      }
      return translations[key] || key
    },
  }),
}))

// Mock lodash-es debounce
vi.mock('lodash-es', () => ({
  debounce: (fn: any) => fn,
}))

describe('InputWithCopy component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCopyToClipboard.mockClear()
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

  it('copies input value when copy button is clicked', async () => {
    const mockOnChange = vi.fn()
    render(<InputWithCopy value="test value" onChange={mockOnChange} />)

    const copyButton = screen.getByRole('button')
    fireEvent.click(copyButton)

    expect(mockCopyToClipboard).toHaveBeenCalledWith('test value')
  })

  it('copies custom value when copyValue prop is provided', async () => {
    const mockOnChange = vi.fn()
    render(<InputWithCopy value="display value" onChange={mockOnChange} copyValue="custom copy value" />)

    const copyButton = screen.getByRole('button')
    fireEvent.click(copyButton)

    expect(mockCopyToClipboard).toHaveBeenCalledWith('custom copy value')
  })

  it('calls onCopy callback when copy button is clicked', async () => {
    const onCopyMock = vi.fn()
    const mockOnChange = vi.fn()
    render(<InputWithCopy value="test value" onChange={mockOnChange} onCopy={onCopyMock} />)

    const copyButton = screen.getByRole('button')
    fireEvent.click(copyButton)

    expect(onCopyMock).toHaveBeenCalledWith('test value')
  })

  it('shows copied state after successful copy', async () => {
    const mockOnChange = vi.fn()
    render(<InputWithCopy value="test value" onChange={mockOnChange} />)

    const copyButton = screen.getByRole('button')
    fireEvent.click(copyButton)

    // Hover over the button to trigger tooltip
    fireEvent.mouseEnter(copyButton)

    // Check if the tooltip shows "Copied" state
    await waitFor(() => {
      expect(screen.getByText('Copied')).toBeInTheDocument()
    }, { timeout: 2000 })
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
    expect(copyButton).toBeInTheDocument()

    fireEvent.click(copyButton)
    expect(mockCopyToClipboard).toHaveBeenCalledWith('')
  })

  it('maintains focus on input after copy', async () => {
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
