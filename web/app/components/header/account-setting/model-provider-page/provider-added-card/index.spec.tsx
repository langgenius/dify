import type { ModelItem, ModelProvider } from '../declarations'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { fetchModelProviderModelList } from '@/service/common'
import { ConfigurationMethodEnum } from '../declarations'
import ProviderAddedCard from './index'

let mockIsCurrentWorkspaceManager = true
type SubscriptionPayload = { type?: string, payload?: string } | unknown
let subscriptionHandler: ((value: SubscriptionPayload) => void) | undefined
const mockEventEmitter: { useSubscription: unknown, emit: unknown } = {
  useSubscription: vi.fn((handler: (value: SubscriptionPayload) => void) => {
    subscriptionHandler = handler
  }),
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
    subscriptionHandler = undefined
  })

  it('should render provider added card component', () => {
    const { container } = render(<ProviderAddedCard provider={mockProvider} />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('should open and refresh model list from user actions', async () => {
    vi.mocked(fetchModelProviderModelList).mockResolvedValue({ data: [{ model: 'gpt-4' }] } as unknown as { data: ModelItem[] })
    render(<ProviderAddedCard provider={mockProvider} />)

    const showModelsBtn = screen.getAllByText('common.modelProvider.showModels')[1]
    fireEvent.click(showModelsBtn)

    await screen.findByTestId('model-list')
    expect(fetchModelProviderModelList).toHaveBeenCalledWith(`/workspaces/current/model-providers/${mockProvider.provider}/models`)

    fireEvent.click(screen.getByRole('button', { name: 'refresh list' }))
    await waitFor(() => {
      expect(fetchModelProviderModelList).toHaveBeenCalledTimes(2)
    })

    fireEvent.click(screen.getByRole('button', { name: 'collapse list' }))
    expect(screen.getAllByText(/common\.modelProvider\.showModelsNum:\{"num":1\}/).length).toBeGreaterThan(0)
  })

  it('should render configure tip when provider is not in quota list and not configured', () => {
    const providerWithoutQuota = {
      ...mockProvider,
      provider: 'custom/provider',
    } as unknown as ModelProvider
    render(<ProviderAddedCard provider={providerWithoutQuota} notConfigured />)
    expect(screen.getByText('common.modelProvider.configureTip')).toBeInTheDocument()
  })

  it('should refresh model list on matching event subscription', async () => {
    vi.mocked(fetchModelProviderModelList).mockResolvedValue({ data: [{ model: 'gpt-4' }] } as unknown as { data: ModelItem[] })
    render(<ProviderAddedCard provider={mockProvider} notConfigured />)

    expect(subscriptionHandler).toBeTruthy()
    await act(async () => {
      subscriptionHandler?.({
        type: 'UPDATE_MODEL_PROVIDER_CUSTOM_MODEL_LIST',
        payload: mockProvider.provider,
      })
    })

    await waitFor(() => {
      expect(fetchModelProviderModelList).toHaveBeenCalledTimes(1)
    })
  })

  it('should render custom model actions only for workspace managers', () => {
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
})
