import type { ModelItem, ModelProvider } from '../declarations'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfigurationMethodEnum } from '../declarations'
import ModelLoadBalancingModal from './model-load-balancing-modal'

type CredentialData = {
  load_balancing: {
    enabled: boolean
    configs: Array<{
      id: string
      credential_id: string
      enabled: boolean
      name: string
      credentials: { api_key: string }
    }>
  }
  current_credential_id: string
  available_credentials: Array<{ credential_id: string, credential_name: string }>
  current_credential_name: string
}

const mockNotify = vi.fn()
const mockMutateAsync = vi.fn()
const mockRefetch = vi.fn()
const mockHandleRefreshModel = vi.fn()
const mockHandleConfirmDelete = vi.fn()
const mockOpenConfirmDelete = vi.fn()

let mockDeleteModel: unknown = null
let mockCredentialData: CredentialData | undefined = {
  load_balancing: {
    enabled: true,
    configs: [
      { id: 'cfg-1', credential_id: 'cred-1', enabled: true, name: 'Default', credentials: { api_key: 'same-key' } },
      { id: 'cfg-2', credential_id: 'cred-2', enabled: true, name: 'Backup', credentials: { api_key: 'backup-key' } },
    ],
  },
  current_credential_id: 'cred-1',
  available_credentials: [
    { credential_id: 'cred-1', credential_name: 'Default' },
    { credential_id: 'cred-2', credential_name: 'Backup' },
  ],
  current_credential_name: 'Default',
}

vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({
    notify: mockNotify,
  }),
}))

vi.mock('@/service/use-models', () => ({
  useGetModelCredential: () => ({
    isLoading: false,
    data: mockCredentialData,
    refetch: mockRefetch,
  }),
  useUpdateModelLoadBalancingConfig: () => ({
    mutateAsync: mockMutateAsync,
  }),
}))

vi.mock('../model-auth/hooks/use-auth', () => ({
  useAuth: () => ({
    doingAction: false,
    deleteModel: mockDeleteModel,
    openConfirmDelete: mockOpenConfirmDelete,
    closeConfirmDelete: vi.fn(),
    handleConfirmDelete: mockHandleConfirmDelete,
  }),
}))

vi.mock('../hooks', () => ({
  useRefreshModel: () => ({ handleRefreshModel: mockHandleRefreshModel }),
}))

vi.mock('./model-load-balancing-configs', () => ({
  default: ({ onUpdate, onRemove }: {
    onUpdate?: (payload?: unknown, formValues?: Record<string, unknown>) => void
    onRemove?: (credentialId: string) => void
  }) => (
    <div>
      <button type="button" onClick={() => onUpdate?.(undefined, { __authorization_name__: 'New Key' })}>config add credential</button>
      <button type="button" onClick={() => onUpdate?.({ credential: { credential_id: 'cred-1' } }, { __authorization_name__: 'Renamed Key' })}>config rename credential</button>
      <button type="button" onClick={() => onRemove?.('cred-1')}>config remove</button>
    </div>
  ),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-auth', () => ({
  SwitchCredentialInLoadBalancing: ({ onUpdate }: { onUpdate: () => void }) => (
    <button type="button" onClick={onUpdate}>switch credential</button>
  ),
}))

vi.mock('../model-icon', () => ({
  default: () => <div>model-icon</div>,
}))

vi.mock('../model-name', () => ({
  default: () => <div>model-name</div>,
}))

describe('ModelLoadBalancingModal', () => {
  const mockProvider = {
    provider: 'test-provider',
    provider_credential_schema: {
      credential_form_schemas: [{ type: 'secret-input', variable: 'api_key' }],
    },
    model_credential_schema: {
      credential_form_schemas: [{ type: 'secret-input', variable: 'api_key' }],
    },
  } as unknown as ModelProvider

  const mockModel = {
    model: 'gpt-4',
    model_type: 'llm',
    fetch_from: 'predefined-model',
  } as unknown as ModelItem

  beforeEach(() => {
    vi.clearAllMocks()
    mockDeleteModel = null
    mockCredentialData = {
      load_balancing: {
        enabled: true,
        configs: [
          { id: 'cfg-1', credential_id: 'cred-1', enabled: true, name: 'Default', credentials: { api_key: 'same-key' } },
          { id: 'cfg-2', credential_id: 'cred-2', enabled: true, name: 'Backup', credentials: { api_key: 'backup-key' } },
        ],
      },
      current_credential_id: 'cred-1',
      available_credentials: [
        { credential_id: 'cred-1', credential_name: 'Default' },
        { credential_id: 'cred-2', credential_name: 'Backup' },
      ],
      current_credential_name: 'Default',
    }
    mockMutateAsync.mockResolvedValue({ result: 'success' })
    mockRefetch.mockResolvedValue({ data: mockCredentialData })
  })

  it('should show loading area while draft config is not ready', () => {
    mockCredentialData = undefined

    render(
      <ModelLoadBalancingModal
        provider={mockProvider}
        configurateMethod={ConfigurationMethodEnum.predefinedModel}
        model={mockModel}
        open
      />,
    )

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('should render predefined model content', () => {
    render(
      <ModelLoadBalancingModal
        provider={mockProvider}
        configurateMethod={ConfigurationMethodEnum.predefinedModel}
        model={mockModel}
        open
      />,
    )

    expect(screen.getByText(/modelProvider\.auth\.configLoadBalancing/)).toBeInTheDocument()
    expect(screen.getByText(/modelProvider\.auth\.providerManaged$/)).toBeInTheDocument()
    expect(screen.getByText(/operation\.save/)).toBeInTheDocument()
  })

  it('should render custom model actions and close when update has no credentials', async () => {
    const onClose = vi.fn()
    mockRefetch.mockResolvedValue({ data: { available_credentials: [] } })
    render(
      <ModelLoadBalancingModal
        provider={mockProvider}
        configurateMethod={ConfigurationMethodEnum.customizableModel}
        model={mockModel}
        open
        onClose={onClose}
      />,
    )

    expect(screen.getByText(/modelProvider\.auth\.removeModel/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'switch credential' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'config add credential' }))
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('should save load balancing config and close modal', async () => {
    const onSave = vi.fn()
    const onClose = vi.fn()

    render(
      <ModelLoadBalancingModal
        provider={mockProvider}
        configurateMethod={ConfigurationMethodEnum.predefinedModel}
        model={mockModel}
        open
        onSave={onSave}
        onClose={onClose}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'config add credential' }))
    fireEvent.click(screen.getByRole('button', { name: 'config rename credential' }))
    fireEvent.click(screen.getByText(/operation\.save/))

    await waitFor(() => {
      expect(mockRefetch).toHaveBeenCalled()
      expect(mockMutateAsync).toHaveBeenCalled()
      const payload = mockMutateAsync.mock.calls[0][0] as { load_balancing: { configs: Array<{ credentials: { api_key: string } }> } }
      expect(payload.load_balancing.configs[0].credentials.api_key).toBe('[__HIDDEN__]')
      expect(mockNotify).toHaveBeenCalled()
      expect(mockHandleRefreshModel).toHaveBeenCalled()
      expect(onSave).toHaveBeenCalledWith('test-provider')
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('should close modal when switching credential yields no available credentials', async () => {
    const onClose = vi.fn()
    mockRefetch.mockResolvedValue({ data: { available_credentials: [] } })

    render(
      <ModelLoadBalancingModal
        provider={mockProvider}
        configurateMethod={ConfigurationMethodEnum.customizableModel}
        model={mockModel}
        open
        onClose={onClose}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'switch credential' }))
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('should confirm model deletion and close modal', async () => {
    const onClose = vi.fn()
    mockDeleteModel = { model: 'gpt-4' }

    render(
      <ModelLoadBalancingModal
        provider={mockProvider}
        configurateMethod={ConfigurationMethodEnum.customizableModel}
        model={mockModel}
        open
        onClose={onClose}
      />,
    )

    fireEvent.click(screen.getByText(/modelProvider\.auth\.removeModel/))
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    await waitFor(() => {
      expect(mockOpenConfirmDelete).toHaveBeenCalled()
      expect(mockHandleConfirmDelete).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })
  })
})
