import type { ReactNode } from 'react'
import type { ModelProvider } from '../declarations'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfigurationMethodEnum } from '../declarations'
import ProviderAddedCard from './index'

let mockIsCurrentWorkspaceManager = true
const mockFetchModelProviderModels = vi.fn()
const mockQueryOptions = vi.fn(({ input, ...options }: { input: { params: { provider: string } }, enabled?: boolean }) => ({
  queryKey: ['console', 'modelProviders', 'models', input.params.provider],
  queryFn: () => mockFetchModelProviderModels(input.params.provider),
  ...options,
}))
const mockEventEmitter = {
  useSubscription: vi.fn(),
  emit: vi.fn(),
}

vi.mock('@/service/client', () => ({
  consoleQuery: {
    modelProviders: {
      models: {
        queryOptions: (options: { input: { params: { provider: string } }, enabled?: boolean }) => mockQueryOptions(options),
      },
    },
  },
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

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false, gcTime: 0 },
  },
})

const renderWithQueryClient = (node: ReactNode) => {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      {node}
    </QueryClientProvider>,
  )
}

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
    renderWithQueryClient(<ProviderAddedCard provider={mockProvider} />)
    expect(screen.getByTestId('provider-added-card')).toBeInTheDocument()
    expect(screen.getByTestId('provider-icon')).toBeInTheDocument()
  })

  it('should open, refresh and collapse model list', async () => {
    mockFetchModelProviderModels.mockResolvedValue({ data: [{ model: 'gpt-4' }] })
    renderWithQueryClient(<ProviderAddedCard provider={mockProvider} />)

    const showModelsBtn = screen.getByTestId('show-models-button')
    fireEvent.click(showModelsBtn)

    await waitFor(() => {
      expect(mockFetchModelProviderModels).toHaveBeenCalledWith(mockProvider.provider)
    })
    expect(await screen.findByTestId('model-list')).toBeInTheDocument()

    // Test line 71-72: Opening when already fetched
    const collapseBtn = screen.getByRole('button', { name: 'collapse list' })
    fireEvent.click(collapseBtn)
    await waitFor(() => expect(screen.queryByTestId('model-list')).not.toBeInTheDocument())

    // Explicitly re-find and click to re-open
    fireEvent.click(screen.getByTestId('show-models-button'))
    expect(await screen.findByTestId('model-list')).toBeInTheDocument()
    expect(mockFetchModelProviderModels).toHaveBeenCalledTimes(1) // Should not fetch again

    // Refresh list from ModelList
    const refreshBtn = screen.getByRole('button', { name: 'refresh list' })
    fireEvent.click(refreshBtn)
    await waitFor(() => {
      expect(mockFetchModelProviderModels).toHaveBeenCalledTimes(2)
    })
  })

  it('should handle concurrent getModelList calls (loading state coverage)', async () => {
    let resolveOuter: (value: unknown) => void = () => { }
    const promise = new Promise((resolve) => {
      resolveOuter = resolve
    })
    mockFetchModelProviderModels.mockReturnValue(promise)

    renderWithQueryClient(<ProviderAddedCard provider={mockProvider} />)
    const showModelsBtn = screen.getByTestId('show-models-button')

    // First call sets loading to true
    fireEvent.click(showModelsBtn)
    await waitFor(() => {
      expect(mockFetchModelProviderModels).toHaveBeenCalledTimes(1)
    })

    // Second call should return early because loading is true
    fireEvent.click(showModelsBtn)
    expect(mockFetchModelProviderModels).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveOuter({ data: [] })
    })
    // After resolution, loading is false and collapsed is false, so model-list appears
    expect(await screen.findByTestId('model-list')).toBeInTheDocument()
  })

  it('should render configure tip when provider is not in quota list and not configured', () => {
    const providerWithoutQuota = {
      ...mockProvider,
      provider: 'custom/provider',
    } as unknown as ModelProvider
    renderWithQueryClient(<ProviderAddedCard provider={providerWithoutQuota} notConfigured />)
    expect(screen.getByText('common.modelProvider.configureTip')).toBeInTheDocument()
  })

  it('should refresh model list on event subscription', async () => {
    let capturedHandler: (v: { type: string, payload: string } | null) => void = () => { }
    mockEventEmitter.useSubscription.mockImplementation((handler: (v: unknown) => void) => {
      capturedHandler = handler as (v: { type: string, payload: string } | null) => void
    })
    mockFetchModelProviderModels.mockResolvedValue({ data: [] })

    renderWithQueryClient(<ProviderAddedCard provider={mockProvider} />)

    expect(capturedHandler).toBeDefined()
    act(() => {
      capturedHandler({
        type: 'UPDATE_MODEL_PROVIDER_CUSTOM_MODEL_LIST',
        payload: mockProvider.provider,
      })
    })

    await waitFor(() => {
      expect(mockFetchModelProviderModels).toHaveBeenCalledTimes(1)
    })

    // Should ignore non-matching events
    act(() => {
      capturedHandler({ type: 'OTHER', payload: '' })
      capturedHandler(null)
    })
    expect(mockFetchModelProviderModels).toHaveBeenCalledTimes(1)
  })

  it('should render custom model actions for workspace managers', () => {
    const customConfigProvider = {
      ...mockProvider,
      configurate_methods: [ConfigurationMethodEnum.customizableModel],
    } as unknown as ModelProvider
    const queryClient = createTestQueryClient()
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <ProviderAddedCard provider={customConfigProvider} />
      </QueryClientProvider>,
    )

    expect(screen.getByTestId('manage-custom-model')).toBeInTheDocument()
    expect(screen.getByTestId('add-custom-model')).toBeInTheDocument()

    mockIsCurrentWorkspaceManager = false
    rerender(
      <QueryClientProvider client={queryClient}>
        <ProviderAddedCard provider={customConfigProvider} />
      </QueryClientProvider>,
    )
    expect(screen.queryByTestId('manage-custom-model')).not.toBeInTheDocument()
  })
})
