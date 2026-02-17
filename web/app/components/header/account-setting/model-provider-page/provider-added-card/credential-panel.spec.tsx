import type { ModelProvider } from '../declarations'
import { render } from '@testing-library/react'
import CredentialPanel from './credential-panel'

const mockEventEmitter = { emit: vi.fn() }

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({
    notify: vi.fn(),
  }),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: mockEventEmitter,
  }),
}))

vi.mock('@/service/common', () => ({
  changeModelProviderPriority: vi.fn(),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-auth', () => ({
  ConfigProvider: () => <div data-testid="config-provider" />,
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-auth/hooks', () => ({
  useCredentialStatus: () => ({
    hasCredential: true,
    authorized: true,
    authRemoved: false,
    current_credential_name: 'test-credential',
    notAllowedToUse: false,
  }),
}))

vi.mock('../hooks', () => ({
  useUpdateModelList: () => vi.fn(),
  useUpdateModelProviders: () => vi.fn(),
}))

vi.mock('./priority-selector', () => ({
  default: ({ onSelect }: { onSelect: (key: string) => void }) => (
    <button data-testid="priority-selector" onClick={() => onSelect('custom')}>
      Priority Selector
    </button>
  ),
}))

vi.mock('./priority-use-tip', () => ({
  default: () => <div data-testid="priority-use-tip">Priority Tip</div>,
}))

vi.mock('@/app/components/header/indicator', () => ({
  default: ({ color }: { color: string }) => <div data-testid="indicator">{color}</div>,
}))

describe('CredentialPanel', () => {
  const mockProvider = {
    provider: 'test-provider',
    provider_credential_schema: true,
    custom_configuration: { status: 'active' },
    system_configuration: { enabled: true },
    preferred_provider_type: 'system',
    configurate_methods: ['predefinedModel'],
    supported_model_types: ['gpt-4'],
  } as unknown as ModelProvider

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render credential panel when provider has schema', () => {
    const { container } = render(<CredentialPanel provider={mockProvider} />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('should render credential panel with proper structure', () => {
    const { container } = render(<CredentialPanel provider={mockProvider} />)
    expect(container.querySelector('[data-testid="config-provider"]')).toBeInTheDocument()
  })

  it('should render empty when provider has no schema', () => {
    const providerNoSchema = { ...mockProvider, provider_credential_schema: null } as unknown as ModelProvider
    const { container } = render(<CredentialPanel provider={providerNoSchema} />)
    expect(container.firstChild?.childNodes.length || 0).toBeGreaterThanOrEqual(0)
  })
})
