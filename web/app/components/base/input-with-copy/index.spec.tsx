import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import InputWithCopy from './index'

// Mock the copy-to-clipboard library
jest.mock('copy-to-clipboard', () => jest.fn(() => true))

// Mock the i18n hook
jest.mock('react-i18next', () => ({
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
jest.mock('lodash-es', () => ({
  debounce: (fn: any) => fn,
}))

describe('InputWithCopy component', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders correctly with default props', () => {
    const mockOnChange = jest.fn()
    render(<InputWithCopy value="test value" onChange={mockOnChange} />)
    const input = screen.getByDisplayValue('test value')
    const copyButton = screen.getByRole('button')
    expect(input).toBeInTheDocument()
    expect(copyButton).toBeInTheDocument()
  })

  it('hides copy button when showCopyButton is false', () => {
    const mockOnChange = jest.fn()
    render(<InputWithCopy value="test value" onChange={mockOnChange} showCopyButton={false} />)
    const input = screen.getByDisplayValue('test value')
    const copyButton = screen.queryByRole('button')
    expect(input).toBeInTheDocument()
    expect(copyButton).not.toBeInTheDocument()
  })

  it('copies input value when copy button is clicked', async () => {
    const copyToClipboard = require('copy-to-clipboard')
    const mockOnChange = jest.fn()
    render(<InputWithCopy value="test value" onChange={mockOnChange} />)

    const copyButton = screen.getByRole('button')
    fireEvent.click(copyButton)

    expect(copyToClipboard).toHaveBeenCalledWith('test value')
  })

  it('copies custom value when copyValue prop is provided', async () => {
    const copyToClipboard = require('copy-to-clipboard')
    const mockOnChange = jest.fn()
    render(<InputWithCopy value="display value" onChange={mockOnChange} copyValue="custom copy value" />)

    const copyButton = screen.getByRole('button')
    fireEvent.click(copyButton)

    expect(copyToClipboard).toHaveBeenCalledWith('custom copy value')
  })

  it('calls onCopy callback when copy button is clicked', async () => {
    const onCopyMock = jest.fn()
    const mockOnChange = jest.fn()
    render(<InputWithCopy value="test value" onChange={mockOnChange} onCopy={onCopyMock} />)

    const copyButton = screen.getByRole('button')
    fireEvent.click(copyButton)

    expect(onCopyMock).toHaveBeenCalledWith('test value')
  })

  it('shows copied state after successful copy', async () => {
    const mockOnChange = jest.fn()
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
    const mockOnChange = jest.fn()
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
    const copyToClipboard = require('copy-to-clipboard')
    const mockOnChange = jest.fn()
    render(<InputWithCopy value="" onChange={mockOnChange} />)
    const input = screen.getByRole('textbox')
    const copyButton = screen.getByRole('button')

    expect(input).toBeInTheDocument()
    expect(copyButton).toBeInTheDocument()

    fireEvent.click(copyButton)
    expect(copyToClipboard).toHaveBeenCalledWith('')
  })

  it('maintains focus on input after copy', async () => {
    const mockOnChange = jest.fn()
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
