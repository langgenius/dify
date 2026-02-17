import type {
  CustomModelCredential,
  ModelCredential,
  ModelLoadBalancingConfig,
  ModelProvider,
} from '../declarations'
import { render, screen } from '@testing-library/react'
import { ConfigurationMethodEnum } from '../declarations'
import ModelLoadBalancingConfigs from './model-load-balancing-configs'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string) => _key,
  }),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContextSelector: () => true,
}))

vi.mock('./cooldown-timer', () => ({
  default: ({ secondsRemaining }: { secondsRemaining?: number }) => (
    <div data-testid="cooldown-timer">
      {secondsRemaining}
      s
    </div>
  ),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-auth', () => ({
  AddCredentialInLoadBalancing: () => <div data-testid="add-credential" />,
}))

vi.mock('@/app/components/billing/upgrade-btn', () => ({
  default: () => <div data-testid="upgrade-btn" />,
}))

vi.mock('../../../indicator', () => ({
  default: ({ color }: { color: string }) => <div data-testid="indicator">{color}</div>,
}))

describe('ModelLoadBalancingConfigs', () => {
  const mockProvider = {
    provider: 'test-provider',
  } as unknown as ModelProvider

  const mockDraftConfig = {
    enabled: true,
    configs: [
      {
        id: '1',
        credential_id: 'cred-1',
        enabled: true,
        name: 'Key 1',
      },
    ],
  } as unknown as ModelLoadBalancingConfig

  const mockModelCredential = {
    available_credentials: [
      {
        credential_id: 'cred-1',
        credential_name: 'Key 1',
        not_allowed_to_use: false,
      },
    ],
  } as unknown as ModelCredential

  const mockSetDraftConfig = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render load balancing configs panel', () => {
    render(
      <ModelLoadBalancingConfigs
        draftConfig={mockDraftConfig}
        setDraftConfig={mockSetDraftConfig}
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        modelCredential={mockModelCredential}
        model={{} as unknown as CustomModelCredential}
      />,
    )
    expect(screen.getByText('modelProvider.loadBalancing')).toBeInTheDocument()
  })

  it('should display credential configs when enabled', () => {
    render(
      <ModelLoadBalancingConfigs
        draftConfig={mockDraftConfig}
        setDraftConfig={mockSetDraftConfig}
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        modelCredential={mockModelCredential}
        model={{} as unknown as CustomModelCredential}
      />,
    )
    expect(screen.getByText('Key 1')).toBeInTheDocument()
  })

  it('should return null when draftConfig is undefined', () => {
    const { container } = render(
      <ModelLoadBalancingConfigs
        draftConfig={undefined}
        setDraftConfig={mockSetDraftConfig}
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        modelCredential={mockModelCredential}
        model={{} as unknown as CustomModelCredential}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('should display add credential button when load balancing enabled', () => {
    render(
      <ModelLoadBalancingConfigs
        draftConfig={mockDraftConfig}
        setDraftConfig={mockSetDraftConfig}
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        modelCredential={mockModelCredential}
        model={{} as unknown as CustomModelCredential}
      />,
    )
    expect(screen.getByTestId('add-credential')).toBeInTheDocument()
  })

  it('should render disabled state when load balancing is off', () => {
    const disabledConfig = {
      ...mockDraftConfig,
      enabled: false,
    } as unknown as ModelLoadBalancingConfig
    render(
      <ModelLoadBalancingConfigs
        draftConfig={disabledConfig}
        setDraftConfig={mockSetDraftConfig}
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        modelCredential={mockModelCredential}
        model={{} as unknown as CustomModelCredential}
      />,
    )
    expect(screen.getByText('modelProvider.loadBalancing')).toBeInTheDocument()
  })
})
