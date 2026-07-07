import type { ApiKeyModalProps } from '../api-key-modal'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthCategory } from '../../types'
import AddApiKeyButton from '../add-api-key-button'

let _mockModalOpen = false
vi.mock('../api-key-modal', () => ({
  default: ({ open, onClose, onUpdate }: ApiKeyModalProps) => {
    _mockModalOpen = !!open
    return open
      ? (
          <div data-testid="api-key-modal">
            <button data-testid="modal-close" onClick={onClose}>Close</button>
            <button data-testid="modal-update" onClick={onUpdate}>Update</button>
          </div>
        )
      : null
  },
}))

const defaultPayload = {
  category: AuthCategory.tool,
  provider: 'test-provider',
}

describe('AddApiKeyButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _mockModalOpen = false
  })

  afterEach(() => {
    cleanup()
  })

  it('renders button with default text', () => {
    render(<AddApiKeyButton pluginPayload={defaultPayload} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('renders button with custom text', () => {
    render(<AddApiKeyButton pluginPayload={defaultPayload} buttonText="Add Key" />)
    expect(screen.getByText('Add Key')).toBeInTheDocument()
  })

  it('opens modal when button is clicked', () => {
    render(<AddApiKeyButton pluginPayload={defaultPayload} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByTestId('api-key-modal')).toBeInTheDocument()
  })

  it('calls custom onClick instead of mounting the inline modal', () => {
    const handleClick = vi.fn()

    render(<AddApiKeyButton pluginPayload={defaultPayload} onClick={handleClick} />)
    fireEvent.click(screen.getByRole('button'))

    expect(handleClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('api-key-modal')).not.toBeInTheDocument()
  })

  it('respects disabled prop', () => {
    render(<AddApiKeyButton pluginPayload={defaultPayload} disabled />)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('closes modal when onClose is called', () => {
    render(<AddApiKeyButton pluginPayload={defaultPayload} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByTestId('api-key-modal')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('modal-close'))
    expect(screen.queryByTestId('api-key-modal')).not.toBeInTheDocument()
  })

  it('applies custom button variant', () => {
    render(<AddApiKeyButton pluginPayload={defaultPayload} buttonVariant="primary" />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })
})
