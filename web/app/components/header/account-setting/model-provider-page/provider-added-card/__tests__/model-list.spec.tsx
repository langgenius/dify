import type { ModelProviderSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ModelItem, ModelProvider } from '../../declarations'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { ConfigurationMethodEnum } from '../../declarations'
import ModelList from '../model-list'

const mockLoadProviderDetail = vi.fn()
const { mockLoadModelLoadBalancingModal } = vi.hoisted(() => ({
  mockLoadModelLoadBalancingModal: vi.fn(),
}))
const { mockToastError } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
}))
let mockWorkspacePermissionKeys: string[] = [
  'plugin.model_config',
  'credential.manage',
  'credential.use',
]

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }))
})

vi.mock('../../hooks', () => ({
  useLazyModelProviderDetail: () => ({
    loadProviderDetail: mockLoadProviderDetail,
  }),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: mockToastError,
  },
}))

const MockModelLoadBalancingModal = ({
  onClose,
  onSave,
}: {
  onClose?: () => void
  onSave?: (provider: string) => void
}) => (
  <div data-testid="model-load-balancing-modal">
    <button type="button" onClick={() => onSave?.('test-provider')}>
      Save load balancing
    </button>
    <button type="button" onClick={onClose}>
      Close load balancing
    </button>
  </div>
)

vi.mock('../model-load-balancing-modal', () => mockLoadModelLoadBalancingModal())

vi.mock('../lazy-custom-model-actions', () => ({
  default: ({ provider }: { provider: ModelProvider }) => (
    <>
      {(provider.custom_configuration.custom_models?.length ?? 0) > 0 && (
        <div data-testid="manage-credentials" />
      )}
      <button type="button" data-testid="add-custom-model">
        common.modelProvider.addModel
      </button>
    </>
  ),
}))

vi.mock('../model-list-item', () => ({
  default: ({
    model,
    isLoadingLoadBalancing,
    isLoadBalancingDisabled,
    onModifyLoadBalancing,
  }: {
    model: ModelItem
    isLoadingLoadBalancing?: boolean
    isLoadBalancingDisabled?: boolean
    onModifyLoadBalancing: (model: ModelItem) => void
  }) => (
    <button
      type="button"
      disabled={isLoadingLoadBalancing || isLoadBalancingDisabled}
      onClick={() => onModifyLoadBalancing(model)}
    >
      {model.model}
    </button>
  ),
}))

describe('ModelList', () => {
  const mockProvider = {
    provider: 'test-provider',
    configurate_methods: ['customizableModel'],
    custom_configuration: { custom_models: [] },
  } as unknown as ModelProvider

  const mockModels = [
    { model: 'gpt-4', model_type: 'llm', fetch_from: 'system' },
    { model: 'gpt-3.5', model_type: 'llm', fetch_from: 'system' },
  ] as unknown as ModelItem[]

  const mockOnCollapse = vi.fn()
  const mockOnChange = vi.fn()
  const createSummaryProvider = (): ModelProviderSummaryResponse => ({
    provider: 'test-provider',
    plugin_id: 'test-plugin',
    label: { en_US: 'Test provider', zh_Hans: 'Test provider' },
    supported_model_types: ['llm'],
    configurate_methods: ['customizable-model'],
    preferred_provider_type: 'system',
    is_configured: true,
    custom_configuration: {
      status: 'active',
      has_custom_models: false,
      available_credentials: [],
      current_credential_usable: false,
    },
    system_configuration: { enabled: false },
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadProviderDetail.mockResolvedValue(mockProvider)
    mockLoadModelLoadBalancingModal.mockResolvedValue({
      default: MockModelLoadBalancingModal,
    })
    mockWorkspacePermissionKeys = ['plugin.model_config', 'credential.manage', 'credential.use']
  })

  it('should allow reopening the loading dialog after it is dismissed before the module is available', async () => {
    let resolveModule:
      | ((module: { default: typeof MockModelLoadBalancingModal }) => void)
      | undefined
    mockLoadModelLoadBalancingModal.mockImplementationOnce(
      () =>
        new Promise<{ default: typeof MockModelLoadBalancingModal }>((resolve) => {
          resolveModule = resolve
        }),
    )

    render(
      <ModelList
        provider={mockProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'gpt-4' }))

    expect(await screen.findByRole('status')).toHaveAttribute('aria-busy', 'true')

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'gpt-4' }))
    expect(await screen.findByRole('status')).toHaveAttribute('aria-busy', 'true')

    resolveModule?.({ default: MockModelLoadBalancingModal })

    expect(await screen.findByTestId('model-load-balancing-modal')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('should render model count and model items', () => {
    render(
      <ModelList
        provider={mockProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )
    expect(screen.getAllByText(/modelProvider\.modelsNum/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'gpt-4' }))!.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'gpt-3.5' }))!.toBeInTheDocument()
  })

  it('should trigger collapse when collapsed label is clicked', () => {
    render(
      <ModelList
        provider={mockProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )

    const countElements = screen.getAllByText(/modelProvider\.modelsNum/)
    fireEvent.click(countElements[1]!)
    expect(mockOnCollapse).toHaveBeenCalled()
  })

  it('should open load balancing modal for selected model', async () => {
    render(
      <ModelList
        provider={mockProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'gpt-4' }))
    expect(mockLoadProviderDetail).not.toHaveBeenCalled()
    expect(await screen.findByTestId('model-load-balancing-modal')).toBeInTheDocument()
  })

  it('should load provider detail before opening load balancing from a summary card', async () => {
    const summaryProvider = createSummaryProvider()

    render(
      <ModelList
        provider={summaryProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'gpt-4' }))

    expect(mockLoadProviderDetail).toHaveBeenCalledOnce()
    expect(await screen.findByTestId('model-load-balancing-modal')).toBeInTheDocument()
  })

  it('should disable load balancing while provider detail is loading', async () => {
    let resolveProviderDetail: (provider: ModelProvider) => void = () => {}
    mockLoadProviderDetail.mockReturnValue(
      new Promise<ModelProvider>((resolve) => {
        resolveProviderDetail = resolve
      }),
    )
    const summaryProvider = createSummaryProvider()

    render(
      <ModelList
        provider={summaryProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )

    const user = userEvent.setup()
    const modelButton = screen.getByRole('button', { name: 'gpt-4' })
    await user.click(modelButton)

    expect(modelButton).toBeDisabled()
    expect(screen.getByRole('button', { name: 'gpt-3.5' })).toBeDisabled()

    resolveProviderDetail(mockProvider)
    expect(await screen.findByTestId('model-load-balancing-modal')).toBeInTheDocument()
  })

  it('should show an error when provider detail cannot be loaded', async () => {
    mockLoadProviderDetail.mockResolvedValue(undefined)
    const summaryProvider = createSummaryProvider()

    render(
      <ModelList
        provider={summaryProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'gpt-4' }))

    expect(mockToastError).toHaveBeenCalledWith('common.api.actionFailed')
    expect(screen.queryByTestId('model-load-balancing-modal')).not.toBeInTheDocument()
  })

  it('should hide custom model actions without plugin.model_config', () => {
    mockWorkspacePermissionKeys = []
    render(
      <ModelList
        provider={mockProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )

    expect(screen.queryByTestId('manage-credentials')).not.toBeInTheDocument()
    expect(screen.queryByTestId('add-custom-model')).not.toBeInTheDocument()
  })

  it('should hide custom model actions when provider uses predefinedModel only', () => {
    const predefinedProvider = {
      provider: 'test-provider',
      configurate_methods: ['predefinedModel'],
    } as unknown as ModelProvider

    render(
      <ModelList
        provider={predefinedProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )

    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    expect(screen.queryByTestId('manage-credentials')).not.toBeInTheDocument()
    expect(screen.queryByTestId('add-custom-model')).not.toBeInTheDocument()
  })

  it('should call onSave (onChange) and close the load balancing modal', async () => {
    render(
      <ModelList
        provider={mockProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'gpt-4' }))
    await screen.findByTestId('model-load-balancing-modal')
    fireEvent.click(screen.getByRole('button', { name: 'Save load balancing' }))
    expect(mockOnChange).toHaveBeenCalledWith('test-provider')

    fireEvent.click(screen.getByRole('button', { name: 'Close load balancing' }))
    expect(screen.queryByTestId('model-load-balancing-modal')).not.toBeInTheDocument()
  })

  it('should hide custom model actions when provider uses fetchFromRemote only', () => {
    const fetchOnlyProvider = {
      provider: 'test-provider',
      configurate_methods: ['fetchFromRemote'],
    } as unknown as ModelProvider

    render(
      <ModelList
        provider={fetchOnlyProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )

    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    expect(screen.queryByTestId('manage-credentials')).not.toBeInTheDocument()
    expect(screen.queryByTestId('add-custom-model')).not.toBeInTheDocument()
  })

  it('should show Add Model but hide Manage Credentials for configurable providers', () => {
    const configurableProvider = {
      provider: 'test-provider',
      configurate_methods: [ConfigurationMethodEnum.customizableModel],
      custom_configuration: { custom_models: [] },
    } as unknown as ModelProvider

    mockWorkspacePermissionKeys = ['plugin.model_config']

    render(
      <ModelList
        provider={configurableProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )

    expect(screen.queryByTestId('manage-credentials')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'common.modelProvider.addModel' }),
    ).toBeInTheDocument()
  })

  it('should hide custom model actions when provider is configurable but user cannot configure models', () => {
    const configurableProvider = {
      provider: 'test-provider',
      configurate_methods: [ConfigurationMethodEnum.customizableModel],
      custom_configuration: { custom_models: [] },
    } as unknown as ModelProvider

    mockWorkspacePermissionKeys = []

    render(
      <ModelList
        provider={configurableProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )

    expect(screen.queryByTestId('manage-credentials')).not.toBeInTheDocument()
    expect(screen.queryByTestId('add-custom-model')).not.toBeInTheDocument()
  })
})
