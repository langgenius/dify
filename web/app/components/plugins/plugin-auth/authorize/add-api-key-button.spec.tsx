import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthCategory } from '../types'
import AddApiKeyButton from './add-api-key-button'

// Mock ApiKeyModal
let _mockModalOpen = false
vi.mock('./api-key-modal', () => ({
  default: ({ onClose, onUpdate }: { onClose: () => void, onUpdate?: () => void }) => {
    _mockModalOpen = true
    return (
      <div data-testid="api-key-modal">
        <button data-testid="modal-close" onClick={onClose}>Close</button>
        <button data-testid="modal-update" onClick={onUpdate}>Update</button>
      </div>
    )
  },
}))

vi.mock('@/app/components/base/button', () => ({
  default: ({ children, onClick, disabled, variant }: {
    children: React.ReactNode
    onClick?: () => void
    disabled?: boolean
    variant?: string
  }) => (
    <button data-testid="button" data-variant={variant} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
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
    expect(screen.getByTestId('button')).toBeInTheDocument()
  })

  it('renders button with custom text', () => {
    render(<AddApiKeyButton pluginPayload={defaultPayload} buttonText="Add Key" />)
    expect(screen.getByText('Add Key')).toBeInTheDocument()
  })

  it('opens modal when button is clicked', () => {
    render(<AddApiKeyButton pluginPayload={defaultPayload} />)
    fireEvent.click(screen.getByTestId('button'))
    expect(screen.getByTestId('api-key-modal')).toBeInTheDocument()
  })

  it('respects disabled prop', () => {
    render(<AddApiKeyButton pluginPayload={defaultPayload} disabled />)
    expect(screen.getByTestId('button')).toBeDisabled()
  })

  it('closes modal when onClose is called', () => {
    render(<AddApiKeyButton pluginPayload={defaultPayload} />)
    fireEvent.click(screen.getByTestId('button'))
    expect(screen.getByTestId('api-key-modal')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('modal-close'))
    expect(screen.queryByTestId('api-key-modal')).not.toBeInTheDocument()
  })

  it('applies custom button variant', () => {
    render(<AddApiKeyButton pluginPayload={defaultPayload} buttonVariant="primary" />)
    expect(screen.getByTestId('button')).toHaveAttribute('data-variant', 'primary')
  })
})
