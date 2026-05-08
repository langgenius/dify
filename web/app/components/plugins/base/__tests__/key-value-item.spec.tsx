import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import KeyValueItem from '../key-value-item'

vi.mock('../../../base/icons/src/vender/line/files', () => ({
  CopyCheck: () => <span data-testid="copy-check-icon" />,
}))

vi.mock('@/app/components/base/action-button', () => ({
  default: ({
    children,
    onClick,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button data-testid="action-button" onClick={onClick} {...props}>{children}</button>
  ),
}))

const mockWriteTextToClipboard = vi.fn()
vi.mock('@/utils/clipboard', () => ({
  writeTextToClipboard: (...args: unknown[]) => mockWriteTextToClipboard(...args),
}))

describe('KeyValueItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockWriteTextToClipboard.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('renders label and value', () => {
    render(<KeyValueItem label="ID" value="abc-123" />)
    expect(screen.getByText('ID')).toBeInTheDocument()
    expect(screen.getByText('abc-123')).toBeInTheDocument()
  })

  it('renders maskedValue instead of value when provided', () => {
    render(<KeyValueItem label="Key" value="sk-secret" maskedValue="sk-***" />)
    expect(screen.getByText('sk-***')).toBeInTheDocument()
    expect(screen.queryByText('sk-secret')).not.toBeInTheDocument()
  })

  it('copies actual value (not masked) when copy button is clicked', async () => {
    render(<KeyValueItem label="Key" value="sk-secret" maskedValue="sk-***" />)
    fireEvent.click(screen.getByTestId('action-button'))
    expect(mockWriteTextToClipboard).toHaveBeenCalledWith('sk-secret')
  })

  it('renders copy tooltip', () => {
    render(<KeyValueItem label="ID" value="123" />)
    expect(screen.getByRole('button', { name: 'common.operation.copy' })).toBeInTheDocument()
  })
})
