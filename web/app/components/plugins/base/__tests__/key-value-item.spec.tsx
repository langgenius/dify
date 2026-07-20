import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import KeyValueItem from '../key-value-item'

vi.mock('../../../base/icons/src/vender/line/files', () => ({
  CopyCheck: () => <span />,
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
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.copy' }))
    expect(mockCopy).toHaveBeenCalledWith('sk-secret')
  })
})
