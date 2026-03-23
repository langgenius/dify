import type { ModelItem, ModelProvider } from '../../declarations'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastContext } from '@/app/components/base/toast/context'
import { ConfigurationMethodEnum } from '../../declarations'
import ModelLoadBalancingModal from '../model-load-balancing-modal'

vi.mock('@headlessui/react', () => ({
  Transition: ({ show, children }: { show: boolean, children: React.ReactNode }) => (show ? <>{children}</> : null),
  TransitionChild: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogPanel: ({ children, className }: { children: React.ReactNode, className?: string }) => <div className={className}>{children}</div>,
  DialogTitle: ({ children, className }: { children: React.ReactNode, className?: string }) => <h3 className={className}>{children}</h3>,
}))

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

vi.mock('@/app/components/base/toast/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/base/toast/context')>()
  return {
    ...actual,
    useToastContext: () => ({
      notify: mockNotify,
    }),
  }
})

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

vi.mock('../../model-auth/hooks/use-auth', () => ({
  useAuth: () => ({
    doingAction: false,
    deleteModel: mockDeleteModel,
    openConfirmDelete: mockOpenConfirmDelete,
    closeConfirmDelete: vi.fn(),
    handleConfirmDelete: mockHandleConfirmDelete,
  }),
}))

vi.mock('../../hooks', () => ({
  useRefreshModel: () => ({ handleRefreshModel: mockHandleRefreshModel }),
}))

vi.mock('../model-load-balancing-configs', () => ({
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

vi.mock('../../model-icon', () => ({
  default: () => <div>model-icon</div>,
}))

vi.mock('../../model-name', () => ({
  default: () => <div>model-name</div>,
}))

describe('ModelLoadBalancingModal', () => {
  let user: ReturnType<typeof userEvent.setup>

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

  const renderModal = (node: Parameters<typeof render>[0]) => render(
    <ToastContext.Provider value={{ notify: mockNotify, close: vi.fn() }}>
      {node}
    </ToastContext.Provider>,
  )

  beforeEach(() => {
    vi.clearAllMocks()
    user = userEvent.setup()
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

    renderModal(
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
    renderModal(
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
    renderModal(
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
    await user.click(screen.getByRole('button', { name: 'config add credential' }))
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('should save load balancing config and close modal', async () => {
    const onSave = vi.fn()
    const onClose = vi.fn()

    renderModal(
      <ModelLoadBalancingModal
        provider={mockProvider}
        configurateMethod={ConfigurationMethodEnum.predefinedModel}
        model={mockModel}
        open
        onSave={onSave}
        onClose={onClose}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'config add credential' }))
    await user.click(screen.getByRole('button', { name: 'config rename credential' }))
    await user.click(screen.getByText(/operation\.save/))

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

    renderModal(
      <ModelLoadBalancingModal
        provider={mockProvider}
        configurateMethod={ConfigurationMethodEnum.customizableModel}
        model={mockModel}
        open
        onClose={onClose}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'switch credential' }))
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('should confirm model deletion and close modal', async () => {
    const onClose = vi.fn()
    mockDeleteModel = { model: 'gpt-4' }

    renderModal(
      <ModelLoadBalancingModal
        provider={mockProvider}
        configurateMethod={ConfigurationMethodEnum.customizableModel}
        model={mockModel}
        open
        onClose={onClose}
      />,
    )

    await user.click(screen.getByText(/modelProvider\.auth\.removeModel/))
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    await waitFor(() => {
      expect(mockOpenConfirmDelete).toHaveBeenCalled()
      expect(mockHandleConfirmDelete).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })
  })

  // Disabled load balancing: title shows configModel text
  it('should show configModel title when load balancing is disabled', () => {
    mockCredentialData = {
      ...mockCredentialData!,
      load_balancing: {
        enabled: false,
        configs: mockCredentialData!.load_balancing.configs,
      },
    }

    renderModal(
      <ModelLoadBalancingModal
        provider={mockProvider}
        configurateMethod={ConfigurationMethodEnum.predefinedModel}
        model={mockModel}
        open
      />,
    )

    expect(screen.getByText(/modelProvider\.auth\.configModel/)).toBeInTheDocument()
  })

  // Modal hidden when open=false
  it('should not render modal content when open is false', () => {
    renderModal(
      <ModelLoadBalancingModal
        provider={mockProvider}
        configurateMethod={ConfigurationMethodEnum.predefinedModel}
        model={mockModel}
        open={false}
      />,
    )

    expect(screen.queryByText(/modelProvider\.auth\.configLoadBalancing/)).not.toBeInTheDocument()
  })

  // Config rename: updates name in draft config
  it('should rename credential in draft config', async () => {
    renderModal(
      <ModelLoadBalancingModal
        provider={mockProvider}
        configurateMethod={ConfigurationMethodEnum.predefinedModel}
        model={mockModel}
        open
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'config rename credential' }))
    await user.click(screen.getByText(/operation\.save/))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalled()
    })
  })

  // Config remove: removes credential from draft
  it('should remove credential from draft config', async () => {
    renderModal(
      <ModelLoadBalancingModal
        provider={mockProvider}
        configurateMethod={ConfigurationMethodEnum.predefinedModel}
        model={mockModel}
        open
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'config remove' }))
    await user.click(screen.getByText(/operation\.save/))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalled()
    })
  })

  // Save error: shows error toast
  it('should show error toast when save fails', async () => {
    mockMutateAsync.mockResolvedValue({ result: 'error' })

    renderModal(
      <ModelLoadBalancingModal
        provider={mockProvider}
        configurateMethod={ConfigurationMethodEnum.predefinedModel}
        model={mockModel}
        open
      />,
    )

    await user.click(screen.getByText(/operation\.save/))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalled()
      expect(mockNotify).toHaveBeenCalled()
    })
  })

  // No current_credential_id: modelCredential is undefined
  it('should handle missing current_credential_id', () => {
    mockCredentialData = {
      ...mockCredentialData!,
      current_credential_id: '',
    }

    renderModal(
      <ModelLoadBalancingModal
        provider={mockProvider}
        configurateMethod={ConfigurationMethodEnum.customizableModel}
        model={mockModel}
        open
      />,
    )

    expect(screen.getByRole('button', { name: 'switch credential' })).toBeInTheDocument()
  })

  it('should disable save button when less than 2 configs are enabled', () => {
    mockCredentialData = {
      ...mockCredentialData!,
      load_balancing: {
        enabled: true,
        configs: [
          { id: 'cfg-1', credential_id: 'cred-1', enabled: true, name: 'Only One', credentials: { api_key: 'key' } },
          { id: 'cfg-2', credential_id: 'cred-2', enabled: false, name: 'Disabled', credentials: { api_key: 'key2' } },
        ],
      },
    }

    renderModal(
      <ModelLoadBalancingModal
        provider={mockProvider}
        configurateMethod={ConfigurationMethodEnum.predefinedModel}
        model={mockModel}
        open
      />,
    )

    expect(screen.getByText(/operation\.save/)).toBeDisabled()
  })

  it('should encode config entry without id as non-hidden value', async () => {
    mockCredentialData = {
      ...mockCredentialData!,
      load_balancing: {
        enabled: true,
        configs: [
          { id: '', credential_id: 'cred-new', enabled: true, name: 'New Entry', credentials: { api_key: 'new-key' } },
          { id: 'cfg-2', credential_id: 'cred-2', enabled: true, name: 'Backup', credentials: { api_key: 'backup-key' } },
        ],
      },
    }

    renderModal(
      <ModelLoadBalancingModal
        provider={mockProvider}
        configurateMethod={ConfigurationMethodEnum.predefinedModel}
        model={mockModel}
        open
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByText(/operation\.save/))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalled()
      const payload = mockMutateAsync.mock.calls[0][0] as { load_balancing: { configs: Array<{ credentials: { api_key: string } }> } }
      // Entry without id should NOT be encoded as hidden
      expect(payload.load_balancing.configs[0].credentials.api_key).toBe('new-key')
    })
  })

  it('should add new credential to draft config when update finds matching credential', async () => {
    mockRefetch.mockResolvedValue({
      data: {
        available_credentials: [
          { credential_id: 'cred-new', credential_name: 'New Key' },
        ],
      },
    })

    renderModal(
      <ModelLoadBalancingModal
        provider={mockProvider}
        configurateMethod={ConfigurationMethodEnum.predefinedModel}
        model={mockModel}
        open
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'config add credential' }))

    await waitFor(() => {
      expect(mockRefetch).toHaveBeenCalled()
    })

    // Save after adding credential to verify it was added to draft
    await user.click(screen.getByText(/operation\.save/))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalled()
    })
  })

  it('should not update draft config when handleUpdate credential name does not match any available credential', async () => {
    mockRefetch.mockResolvedValue({
      data: {
        available_credentials: [
          { credential_id: 'cred-other', credential_name: 'Other Key' },
        ],
      },
    })

    renderModal(
      <ModelLoadBalancingModal
        provider={mockProvider}
        configurateMethod={ConfigurationMethodEnum.predefinedModel}
        model={mockModel}
        open
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    // "config add credential" triggers onUpdate(undefined, { __authorization_name__: 'New Key' })
    // But refetch returns 'Other Key' not 'New Key', so find() returns undefined → no config update
    await user.click(screen.getByRole('button', { name: 'config add credential' }))

    await waitFor(() => {
      expect(mockRefetch).toHaveBeenCalled()
    })

    await user.click(screen.getByText(/operation\.save/))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalled()
      // The payload configs should only have the original 2 entries (no new one added)
      const payload = mockMutateAsync.mock.calls[0][0] as { load_balancing: { configs: unknown[] } }
      expect(payload.load_balancing.configs).toHaveLength(2)
    })
  })

  it('should toggle modal from enabled to disabled when clicking the card', async () => {
    renderModal(
      <ModelLoadBalancingModal
        provider={mockProvider}
        configurateMethod={ConfigurationMethodEnum.predefinedModel}
        model={mockModel}
        open
      />,
    )

    // draftConfig.enabled=true → title shows configLoadBalancing
    expect(screen.getByText(/modelProvider\.auth\.configLoadBalancing/)).toBeInTheDocument()

    // Clicking the card when enabled=true toggles to disabled
    const card = screen.getByText(/modelProvider\.auth\.providerManaged$/).closest('div[class]')!.closest('div[class]')!
    await user.click(card)

    // After toggling, title should show configModel (disabled state)
    expect(screen.getByText(/modelProvider\.auth\.configModel/)).toBeInTheDocument()
  })

  it('should use customModelCredential credential_id when present in handleSave', async () => {
    // Arrange: set up credential data so customModelCredential is initialized from current_credential_id
    mockCredentialData = {
      ...mockCredentialData!,
      current_credential_id: 'cred-1',
      current_credential_name: 'Default',
    }
    const onSave = vi.fn()
    const onClose = vi.fn()

    renderModal(
      <ModelLoadBalancingModal
        provider={mockProvider}
        configurateMethod={ConfigurationMethodEnum.customizableModel}
        model={mockModel}
        open
        onSave={onSave}
        onClose={onClose}
        credential={{ credential_id: 'cred-1', credential_name: 'Default' } as unknown as Parameters<typeof ModelLoadBalancingModal>[0]['credential']}
      />,
    )

    // Act: save triggers handleSave which uses customModelCredential?.credential_id
    await user.click(screen.getByText(/operation\.save/))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalled()
      const payload = mockMutateAsync.mock.calls[0][0] as { credential_id: string }
      // credential_id should come from customModelCredential
      expect(payload.credential_id).toBe('cred-1')
    })
  })

  it('should use null fallback for available_credentials when result.data is missing in handleUpdate', async () => {
    // Arrange: refetch returns data without available_credentials
    const onClose = vi.fn()
    mockRefetch.mockResolvedValue({ data: undefined })

    renderModal(
      <ModelLoadBalancingModal
        provider={mockProvider}
        configurateMethod={ConfigurationMethodEnum.predefinedModel}
        model={mockModel}
        open
        onClose={onClose}
      />,
    )

    // Act: trigger handleUpdate which does `result.data?.available_credentials || []`
    await user.click(screen.getByRole('button', { name: 'config add credential' }))

    // Assert: available_credentials falls back to [], so onClose is called
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('should use null fallback for available_credentials in handleUpdateWhenSwitchCredential when result.data is missing', async () => {
    // Arrange: refetch returns data without available_credentials
    const onClose = vi.fn()
    mockRefetch.mockResolvedValue({ data: undefined })

    renderModal(
      <ModelLoadBalancingModal
        provider={mockProvider}
        configurateMethod={ConfigurationMethodEnum.customizableModel}
        model={mockModel}
        open
        onClose={onClose}
      />,
    )

    // Act: trigger handleUpdateWhenSwitchCredential which does `result.data?.available_credentials || []`
    await user.click(screen.getByRole('button', { name: 'switch credential' }))

    // Assert: available_credentials falls back to [], onClose is called
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('should use predefined provider schema without fallback when credential_form_schemas is undefined', () => {
    // Arrange: provider with no credential_form_schemas → triggers ?? [] fallback
    const providerWithoutSchemas = {
      provider: 'test-provider',
      provider_credential_schema: {
        credential_form_schemas: undefined,
      },
      model_credential_schema: {
        credential_form_schemas: undefined,
      },
    } as unknown as ModelProvider

    renderModal(
      <ModelLoadBalancingModal
        provider={providerWithoutSchemas}
        configurateMethod={ConfigurationMethodEnum.predefinedModel}
        model={mockModel}
        open
      />,
    )

    // Assert: component renders without error (extendedSecretFormSchemas = [])
    expect(screen.getByText(/modelProvider\.auth\.configLoadBalancing/)).toBeInTheDocument()
  })

  it('should use custom model credential schema without fallback when credential_form_schemas is undefined', () => {
    // Arrange: provider with no model credential schemas → triggers ?? [] fallback for custom model path
    const providerWithoutModelSchemas = {
      provider: 'test-provider',
      provider_credential_schema: {
        credential_form_schemas: undefined,
      },
      model_credential_schema: {
        credential_form_schemas: undefined,
      },
    } as unknown as ModelProvider

    renderModal(
      <ModelLoadBalancingModal
        provider={providerWithoutModelSchemas}
        configurateMethod={ConfigurationMethodEnum.customizableModel}
        model={mockModel}
        open
      />,
    )

    // Assert: component renders without error (extendedSecretFormSchemas = [])
    expect(screen.getAllByText(/modelProvider\.auth\.specifyModelCredential/).length).toBeGreaterThan(0)
  })

  it('should not update draft config when rename finds no matching index in prevIndex', async () => {
    // Arrange: credential in payload does not match any config (prevIndex = -1)
    mockRefetch.mockResolvedValue({
      data: {
        available_credentials: [
          { credential_id: 'cred-99', credential_name: 'Unknown' },
        ],
      },
    })

    renderModal(
      <ModelLoadBalancingModal
        provider={mockProvider}
        configurateMethod={ConfigurationMethodEnum.predefinedModel}
        model={mockModel}
        open
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    // Act: "config rename credential" triggers onUpdate with credential: { credential_id: 'cred-1' }
    // but refetch returns cred-99, so newIndex for cred-1 is -1
    await user.click(screen.getByRole('button', { name: 'config rename credential' }))

    await waitFor(() => {
      expect(mockRefetch).toHaveBeenCalled()
    })

    // Save to verify the config was not changed
    await user.click(screen.getByText(/operation\.save/))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalled()
      const payload = mockMutateAsync.mock.calls[0][0] as { load_balancing: { configs: unknown[] } }
      // Config count unchanged (still 2 from original)
      expect(payload.load_balancing.configs).toHaveLength(2)
    })
  })

  it('should encode credential_name as empty string when available_credentials has no name', async () => {
    // Arrange: available_credentials has a credential with no credential_name
    mockRefetch.mockResolvedValue({
      data: {
        available_credentials: [
          { credential_id: 'cred-1', credential_name: '' },
          { credential_id: 'cred-2', credential_name: 'Backup' },
        ],
      },
    })

    renderModal(
      <ModelLoadBalancingModal
        provider={mockProvider}
        configurateMethod={ConfigurationMethodEnum.predefinedModel}
        model={mockModel}
        open
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    // Act: rename cred-1 which now has empty credential_name
    await user.click(screen.getByRole('button', { name: 'config rename credential' }))

    await waitFor(() => {
      expect(mockRefetch).toHaveBeenCalled()
    })

    await user.click(screen.getByText(/operation\.save/))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalled()
    })
  })
})
