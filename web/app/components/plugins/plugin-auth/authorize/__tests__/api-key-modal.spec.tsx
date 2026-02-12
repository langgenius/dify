import type { ApiKeyModalProps } from '../api-key-modal'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthCategory } from '../../types'

const mockNotify = vi.fn()
const mockAddPluginCredential = vi.fn().mockResolvedValue({})
const mockUpdatePluginCredential = vi.fn().mockResolvedValue({})
const mockFormValues = { isCheckValidated: true, values: { __name__: 'My Key', api_key: 'sk-123' } }

vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({
    notify: mockNotify,
  }),
}))

vi.mock('../../hooks/use-credential', () => ({
  useAddPluginCredentialHook: () => ({
    mutateAsync: mockAddPluginCredential,
  }),
  useGetPluginCredentialSchemaHook: () => ({
    data: [
      { name: 'api_key', label: 'API Key', type: 'secret-input', required: true },
    ],
    isLoading: false,
  }),
  useUpdatePluginCredentialHook: () => ({
    mutateAsync: mockUpdatePluginCredential,
  }),
}))

vi.mock('../../../readme-panel/entrance', () => ({
  ReadmeEntrance: () => <div data-testid="readme-entrance" />,
}))

vi.mock('../../../readme-panel/store', () => ({
  ReadmeShowType: { modal: 'modal' },
}))

vi.mock('@/app/components/base/encrypted-bottom', () => ({
  EncryptedBottom: () => <div data-testid="encrypted-bottom" />,
}))

vi.mock('@/app/components/base/modal/modal', () => ({
  default: ({ children, title, onClose, onConfirm, onExtraButtonClick, showExtraButton, disabled }: {
    children: React.ReactNode
    title: string
    onClose?: () => void
    onCancel?: () => void
    onConfirm?: () => void
    onExtraButtonClick?: () => void
    showExtraButton?: boolean
    disabled?: boolean
    [key: string]: unknown
  }) => (
    <div data-testid="modal">
      <div data-testid="modal-title">{title}</div>
      {children}
      <button data-testid="modal-confirm" onClick={onConfirm} disabled={disabled}>Confirm</button>
      <button data-testid="modal-close" onClick={onClose}>Close</button>
      {showExtraButton && <button data-testid="modal-extra" onClick={onExtraButtonClick}>Remove</button>}
    </div>
  ),
}))

vi.mock('@/app/components/base/form/form-scenarios/auth', () => ({
  default: React.forwardRef((_props: Record<string, unknown>, ref: React.Ref<unknown>) => {
    React.useImperativeHandle(ref, () => ({
      getFormValues: () => mockFormValues,
    }))
    return <div data-testid="auth-form" />
  }),
}))

vi.mock('@/app/components/base/form/types', () => ({
  FormTypeEnum: { textInput: 'text-input' },
}))

const basePayload = {
  category: AuthCategory.tool,
  provider: 'test-provider',
}

describe('ApiKeyModal', () => {
  let ApiKeyModal: React.FC<ApiKeyModalProps>

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../api-key-modal')
    ApiKeyModal = mod.default
  })

  it('should render modal with correct title', () => {
    render(<ApiKeyModal pluginPayload={basePayload} />)

    expect(screen.getByTestId('modal-title')).toHaveTextContent('plugin.auth.useApiAuth')
  })

  it('should render auth form when data is loaded', () => {
    render(<ApiKeyModal pluginPayload={basePayload} />)

    expect(screen.getByTestId('auth-form')).toBeInTheDocument()
  })

  it('should show remove button when editValues is provided', () => {
    render(<ApiKeyModal pluginPayload={basePayload} editValues={{ api_key: 'existing' }} />)

    expect(screen.getByTestId('modal-extra')).toBeInTheDocument()
  })

  it('should not show remove button in add mode', () => {
    render(<ApiKeyModal pluginPayload={basePayload} />)

    expect(screen.queryByTestId('modal-extra')).not.toBeInTheDocument()
  })

  it('should call onClose when close button clicked', () => {
    const mockOnClose = vi.fn()
    render(<ApiKeyModal pluginPayload={basePayload} onClose={mockOnClose} />)

    fireEvent.click(screen.getByTestId('modal-close'))
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('should call addPluginCredential on confirm in add mode', async () => {
    const mockOnClose = vi.fn()
    const mockOnUpdate = vi.fn()
    render(<ApiKeyModal pluginPayload={basePayload} onClose={mockOnClose} onUpdate={mockOnUpdate} />)

    fireEvent.click(screen.getByTestId('modal-confirm'))

    await waitFor(() => {
      expect(mockAddPluginCredential).toHaveBeenCalledWith(expect.objectContaining({
        type: 'api-key',
        name: 'My Key',
      }))
    })
  })

  it('should call updatePluginCredential on confirm in edit mode', async () => {
    render(<ApiKeyModal pluginPayload={basePayload} editValues={{ api_key: 'existing', __credential_id__: 'cred-1' }} />)

    fireEvent.click(screen.getByTestId('modal-confirm'))

    await waitFor(() => {
      expect(mockUpdatePluginCredential).toHaveBeenCalled()
    })
  })

  it('should call onRemove when remove button clicked', () => {
    const mockOnRemove = vi.fn()
    render(<ApiKeyModal pluginPayload={basePayload} editValues={{ api_key: 'existing' }} onRemove={mockOnRemove} />)

    fireEvent.click(screen.getByTestId('modal-extra'))
    expect(mockOnRemove).toHaveBeenCalled()
  })

  it('should render readme entrance when detail is provided', () => {
    const payload = { ...basePayload, detail: { name: 'Test' } as never }
    render(<ApiKeyModal pluginPayload={payload} />)

    expect(screen.getByTestId('readme-entrance')).toBeInTheDocument()
  })
})
