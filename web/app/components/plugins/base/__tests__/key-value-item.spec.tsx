import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import KeyValueItem from '../key-value-item'

vi.mock('../../../base/icons/src/vender/line/files', () => ({
  CopyCheck: () => <span data-testid="copy-check-icon" />,
}))

vi.mock('../../../base/tooltip', () => ({
  default: ({ children, popupContent }: { children: React.ReactNode, popupContent: string }) => (
    <div data-testid="tooltip" data-content={popupContent}>{children}</div>
  ),
}))

vi.mock('@/app/components/base/action-button', () => ({
  default: ({ children, onClick }: { children: React.ReactNode, onClick: () => void }) => (
    <button data-testid="action-button" onClick={onClick}>{children}</button>
  ),
}))

const mockCopy = vi.fn()
vi.mock('copy-to-clipboard', () => ({
  default: (...args: unknown[]) => mockCopy(...args),
}))

describe('KeyValueItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
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

  it('copies actual value (not masked) when copy button is clicked', () => {
    render(<KeyValueItem label="Key" value="sk-secret" maskedValue="sk-***" />)
    fireEvent.click(screen.getByTestId('action-button'))
    expect(mockCopy).toHaveBeenCalledWith('sk-secret')
  })

  it('renders copy tooltip', () => {
    render(<KeyValueItem label="ID" value="123" />)
    expect(screen.getByTestId('tooltip')).toHaveAttribute('data-content', 'common.operation.copy')
  })
})
