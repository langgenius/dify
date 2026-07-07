import type { Ref } from 'react'
import type { ApiKeyModalProps } from '../api-key-modal'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useImperativeHandle } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthCategory } from '../../types'

const mockToastSuccess = vi.fn()
const mockAddPluginCredential = vi.fn().mockResolvedValue({})
const mockUpdatePluginCredential = vi.fn().mockResolvedValue({})
const mockFormValues = { isCheckValidated: true, values: { __name__: 'My Key', api_key: 'sk-123' } }

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    success: mockToastSuccess,
  },
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

vi.mock('@/app/components/base/form/form-scenarios/auth', () => {
  const MockAuthForm = ({ ref }: Record<string, unknown> & { ref?: Ref<unknown> }) => {
    useImperativeHandle(ref, () => ({
      getFormValues: () => mockFormValues,
    }))
    return <div data-testid="auth-form" />
  }

  return {
    default: MockAuthForm,
  }
})

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

    expect(screen.getByText('common.operation.remove')).toBeInTheDocument()
  })

  it('should not show remove button in add mode', () => {
    render(<ApiKeyModal pluginPayload={basePayload} />)

    expect(screen.queryByText('common.operation.remove')).not.toBeInTheDocument()
  })

  it('should call close handlers when cancel button is clicked', () => {
    const mockOnClose = vi.fn()
    const mockOnOpenChange = vi.fn()
    render(<ApiKeyModal pluginPayload={basePayload} onClose={mockOnClose} onOpenChange={mockOnOpenChange} />)

    fireEvent.click(screen.getByText('common.operation.cancel'))
    expect(mockOnOpenChange).toHaveBeenCalledWith(false)
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('should call addPluginCredential on confirm in add mode', async () => {
    const mockOnClose = vi.fn()
    const mockOnUpdate = vi.fn()
    render(<ApiKeyModal pluginPayload={basePayload} onClose={mockOnClose} onUpdate={mockOnUpdate} />)

    fireEvent.click(screen.getByText('common.operation.save'))

    await waitFor(() => {
      expect(mockAddPluginCredential).toHaveBeenCalledWith(expect.objectContaining({
        type: 'api-key',
        name: 'My Key',
      }))
    })
  })

  it('should call updatePluginCredential on confirm in edit mode', async () => {
    render(<ApiKeyModal pluginPayload={basePayload} editValues={{ api_key: 'existing', __credential_id__: 'cred-1' }} />)

    fireEvent.click(screen.getByText('common.operation.save'))

    await waitFor(() => {
      expect(mockUpdatePluginCredential).toHaveBeenCalled()
    })
  })

  it('should call onRemove when remove button clicked', () => {
    const mockOnRemove = vi.fn()
    render(<ApiKeyModal pluginPayload={basePayload} editValues={{ api_key: 'existing' }} onRemove={mockOnRemove} />)

    fireEvent.click(screen.getByText('common.operation.remove'))
    expect(mockOnRemove).toHaveBeenCalled()
  })

  it('should render readme entrance when detail is provided', () => {
    const payload = { ...basePayload, detail: { name: 'Test' } as never }
    render(<ApiKeyModal pluginPayload={payload} />)

    expect(screen.getByTestId('readme-entrance')).toBeInTheDocument()
  })
})
