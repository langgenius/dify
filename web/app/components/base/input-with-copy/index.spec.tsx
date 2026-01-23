import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { createReactI18nextMock } from '@/test/i18n-mock'
import InputWithCopy from './index'

// Mock navigator.clipboard for foxact/use-clipboard
const mockWriteText = vi.fn(() => Promise.resolve())

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
    mockWriteText.mockClear()
    // Setup navigator.clipboard mock
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
      },
    })
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

    await waitFor(() => {
      expect(mockWriteText).toHaveBeenCalledWith('test value')
    })
  })

  it('copies custom value when copyValue prop is provided', async () => {
    const mockOnChange = vi.fn()
    render(<InputWithCopy value="display value" onChange={mockOnChange} copyValue="custom copy value" />)

    const copyButton = screen.getByRole('button')
    fireEvent.click(copyButton)

    await waitFor(() => {
      expect(mockWriteText).toHaveBeenCalledWith('custom copy value')
    })
  })

  it('calls onCopy callback when copy button is clicked', async () => {
    const onCopyMock = vi.fn()
    const mockOnChange = vi.fn()
    render(<InputWithCopy value="test value" onChange={mockOnChange} onCopy={onCopyMock} />)

    const copyButton = screen.getByRole('button')
    fireEvent.click(copyButton)

    await waitFor(() => {
      expect(onCopyMock).toHaveBeenCalledWith('test value')
    })
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

  it('handles empty value correctly', async () => {
    const mockOnChange = vi.fn()
    render(<InputWithCopy value="" onChange={mockOnChange} />)
    const input = screen.getByDisplayValue('')
    const copyButton = screen.getByRole('button')

    expect(input).toBeInTheDocument()
    expect(copyButton).toBeInTheDocument()

    fireEvent.click(copyButton)
    await waitFor(() => {
      expect(mockWriteText).toHaveBeenCalledWith('')
    })
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
