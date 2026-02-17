import type { ModelProvider } from '../declarations'
import { render } from '@testing-library/react'
import ProviderAddedCard from './index'

const mockEventEmitter: { useSubscription: unknown, emit: unknown } = {
  useSubscription: vi.fn(),
  emit: vi.fn(),
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { num?: number }) => `${_key}${options?.num ? `:${options.num}` : ''}`,
  }),
}))

vi.mock('@/service/common', () => ({
  fetchModelProviderModelList: vi.fn(),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceManager: true,
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
  default: ({ onCollapse }: { onCollapse: () => void }) => (
    <button data-testid="model-list" onClick={onCollapse}>
      Model List
    </button>
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
  })

  it('should render provider added card component', () => {
    const { container } = render(<ProviderAddedCard provider={mockProvider} />)
    expect(container.firstChild).toBeInTheDocument()
  })
})
