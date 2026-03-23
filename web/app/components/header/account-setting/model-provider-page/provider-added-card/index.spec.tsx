import type { ModelItem, ModelProvider } from '../declarations'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { fetchModelProviderModelList } from '@/service/common'
import { ConfigurationMethodEnum } from '../declarations'
import ProviderAddedCard from './index'

let mockIsCurrentWorkspaceManager = true
const mockEventEmitter = {
  useSubscription: vi.fn(),
  emit: vi.fn(),
}

vi.mock('@/service/common', () => ({
  fetchModelProviderModelList: vi.fn(),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceManager: mockIsCurrentWorkspaceManager,
  }),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: mockEventEmitter,
  }),
}))

// Mock internal components to simplify testing of the index file
vi.mock('./credential-panel', () => ({
  default: () => <div data-testid="credential-panel" />,
}))

vi.mock('./model-list', () => ({
  default: ({ onCollapse, onChange }: { onCollapse: () => void, onChange: (provider: string) => void }) => (
    <div data-testid="model-list">
      <button type="button" onClick={onCollapse}>collapse list</button>
      <button type="button" onClick={() => onChange('langgenius/openai/openai')}>refresh list</button>
    </div>
  ),
}))

vi.mock('../provider-icon', () => ({
  default: () => <div data-testid="provider-icon" />,
}))

vi.mock('../model-badge', () => ({
  default: ({ children }: { children: string }) => <div data-testid="model-badge">{children}</div>,
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-auth', () => ({
  AddCustomModel: () => <div data-testid="add-custom-model" />,
  ManageCustomModelCredentials: () => <div data-testid="manage-custom-model" />,
}))

describe('ProviderAddedCard', () => {
  const mockProvider = {
    provider: 'langgenius/openai/openai',
    configurate_methods: ['predefinedModel'],
    system_configuration: { enabled: true },
    supported_model_types: ['llm'],
  } as unknown as ModelProvider

  beforeEach(() => {
    vi.clearAllMocks()
    mockIsCurrentWorkspaceManager = true
  })

  it('should render provider added card component', () => {
    render(<ProviderAddedCard provider={mockProvider} />)
    expect(screen.getByTestId('provider-added-card')).toBeInTheDocument()
    expect(screen.getByTestId('provider-icon')).toBeInTheDocument()
  })

  it('should open, refresh and collapse model list', async () => {
    vi.mocked(fetchModelProviderModelList).mockResolvedValue({ data: [{ model: 'gpt-4' }] } as unknown as { data: ModelItem[] })
    render(<ProviderAddedCard provider={mockProvider} />)

    const showModelsBtn = screen.getByTestId('show-models-button')
    fireEvent.click(showModelsBtn)

    expect(fetchModelProviderModelList).toHaveBeenCalledWith(`/workspaces/current/model-providers/${mockProvider.provider}/models`)
    expect(await screen.findByTestId('model-list')).toBeInTheDocument()

    // Test line 71-72: Opening when already fetched
    const collapseBtn = screen.getByRole('button', { name: 'collapse list' })
    fireEvent.click(collapseBtn)
    await waitFor(() => expect(screen.queryByTestId('model-list')).not.toBeInTheDocument())

    // Explicitly re-find and click to re-open
    fireEvent.click(screen.getByTestId('show-models-button'))
    expect(await screen.findByTestId('model-list')).toBeInTheDocument()
    expect(fetchModelProviderModelList).toHaveBeenCalledTimes(1) // Should not fetch again

    // Refresh list from ModelList
    const refreshBtn = screen.getByRole('button', { name: 'refresh list' })
    fireEvent.click(refreshBtn)
    await waitFor(() => {
      expect(fetchModelProviderModelList).toHaveBeenCalledTimes(2)
    })
  })

  it('should handle concurrent getModelList calls (loading state coverage)', async () => {
    let resolveOuter: (value: unknown) => void = () => { }
    const promise = new Promise((resolve) => {
      resolveOuter = resolve
    })
    vi.mocked(fetchModelProviderModelList).mockReturnValue(promise as unknown as ReturnType<typeof fetchModelProviderModelList>)

    render(<ProviderAddedCard provider={mockProvider} />)
    const showModelsBtn = screen.getByTestId('show-models-button')

    // First call sets loading to true
    fireEvent.click(showModelsBtn)
    expect(fetchModelProviderModelList).toHaveBeenCalledTimes(1)

    // Second call should return early because loading is true
    fireEvent.click(showModelsBtn)
    expect(fetchModelProviderModelList).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveOuter({ data: [] })
    })
    // After resolution, loading is false and collapsed is false, so model-list appears
    expect(await screen.findByTestId('model-list')).toBeInTheDocument()
  })

  it('should show loading spinner while model list is being fetched', async () => {
    let resolvePromise: (value: unknown) => void = () => {}
    const pendingPromise = new Promise((resolve) => {
      resolvePromise = resolve
    })
    vi.mocked(fetchModelProviderModelList).mockReturnValue(pendingPromise as ReturnType<typeof fetchModelProviderModelList>)

    render(<ProviderAddedCard provider={mockProvider} />)

    fireEvent.click(screen.getByTestId('show-models-button'))

    expect(document.querySelector('.i-ri-loader-2-line.animate-spin')).toBeInTheDocument()

    await act(async () => {
      resolvePromise({ data: [] })
    })
  })

  it('should show modelsNum text after models have loaded', async () => {
    const models = [
      { model: 'gpt-4' },
      { model: 'gpt-3.5' },
    ]
    vi.mocked(fetchModelProviderModelList).mockResolvedValue({ data: models } as unknown as { data: ModelItem[] })

    render(<ProviderAddedCard provider={mockProvider} />)

    fireEvent.click(screen.getByTestId('show-models-button'))

    await screen.findByTestId('model-list')

    const collapseBtn = screen.getByRole('button', { name: 'collapse list' })
    fireEvent.click(collapseBtn)

    await waitFor(() => expect(screen.queryByTestId('model-list')).not.toBeInTheDocument())

    const numTexts = screen.getAllByText(/modelProvider\.modelsNum/)
    expect(numTexts.length).toBeGreaterThan(0)

    expect(screen.getByText(/modelProvider\.showModelsNum/)).toBeInTheDocument()
  })

  it('should render configure tip when provider is not in quota list and not configured', () => {
    const providerWithoutQuota = {
      ...mockProvider,
      provider: 'custom/provider',
    } as unknown as ModelProvider
    render(<ProviderAddedCard provider={providerWithoutQuota} notConfigured />)
    expect(screen.getByText('common.modelProvider.configureTip')).toBeInTheDocument()
  })

  it('should refresh model list on event subscription', async () => {
    let capturedHandler: (v: { type: string, payload: string } | null) => void = () => { }
    mockEventEmitter.useSubscription.mockImplementation((handler: (v: unknown) => void) => {
      capturedHandler = handler as (v: { type: string, payload: string } | null) => void
    })
    vi.mocked(fetchModelProviderModelList).mockResolvedValue({ data: [] } as unknown as { data: ModelItem[] })

    render(<ProviderAddedCard provider={mockProvider} />)

    expect(capturedHandler).toBeDefined()
    act(() => {
      capturedHandler({
        type: 'UPDATE_MODEL_PROVIDER_CUSTOM_MODEL_LIST',
        payload: mockProvider.provider,
      })
    })

    await waitFor(() => {
      expect(fetchModelProviderModelList).toHaveBeenCalledTimes(1)
    })

    // Should ignore non-matching events
    act(() => {
      capturedHandler({ type: 'OTHER', payload: '' })
      capturedHandler(null)
    })
    expect(fetchModelProviderModelList).toHaveBeenCalledTimes(1)
  })

  it('should apply anthropic background class for anthropic provider', () => {
    const anthropicProvider = {
      ...mockProvider,
      provider: 'langgenius/anthropic/anthropic',
    } as unknown as ModelProvider
    const { container } = render(<ProviderAddedCard provider={anthropicProvider} />)

    expect(container.querySelector('.bg-third-party-model-bg-anthropic')).toBeInTheDocument()
  })

  it('should render custom model actions for workspace managers', () => {
    const customConfigProvider = {
      ...mockProvider,
      configurate_methods: [ConfigurationMethodEnum.customizableModel],
    } as unknown as ModelProvider
    const { rerender } = render(<ProviderAddedCard provider={customConfigProvider} />)

    expect(screen.getByTestId('manage-custom-model')).toBeInTheDocument()
    expect(screen.getByTestId('add-custom-model')).toBeInTheDocument()

    mockIsCurrentWorkspaceManager = false
    rerender(<ProviderAddedCard provider={customConfigProvider} />)
    expect(screen.queryByTestId('manage-custom-model')).not.toBeInTheDocument()
  })

  it('should render credential panel when showCredential is true', () => {
    // Arrange: use ConfigurationMethodEnum.predefinedModel ('predefined-model') so showCredential=true
    const predefinedProvider = {
      ...mockProvider,
      configurate_methods: [ConfigurationMethodEnum.predefinedModel],
    } as unknown as ModelProvider

    mockIsCurrentWorkspaceManager = true

    // Act
    render(<ProviderAddedCard provider={predefinedProvider} />)

    // Assert: credential-panel is rendered (showCredential = true branch)
    expect(screen.getByTestId('credential-panel')).toBeInTheDocument()
  })

  it('should not render credential panel when user is not workspace manager', () => {
    // Arrange: predefined-model but manager=false so showCredential=false
    const predefinedProvider = {
      ...mockProvider,
      configurate_methods: [ConfigurationMethodEnum.predefinedModel],
    } as unknown as ModelProvider

    mockIsCurrentWorkspaceManager = false

    // Act
    render(<ProviderAddedCard provider={predefinedProvider} />)

    // Assert: credential-panel is not rendered (showCredential = false)
    expect(screen.queryByTestId('credential-panel')).not.toBeInTheDocument()
  })
})
