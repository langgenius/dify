import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  CurrentSystemQuotaTypeEnum,
  CustomConfigurationStatusEnum,
  QuotaUnitEnum,
} from './declarations'
import ModelProviderPage from './index'

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    mutateCurrentWorkspace: vi.fn(),
    isValidatingCurrentWorkspace: false,
  }),
}))

const mockGlobalState = {
  systemFeatures: { enable_marketplace: true },
}

const mockQuotaConfig = {
  quota_type: CurrentSystemQuotaTypeEnum.free,
  quota_unit: QuotaUnitEnum.times,
  quota_limit: 100,
  quota_used: 1,
  last_used: 0,
  is_valid: true,
}

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (s: { systemFeatures: { enable_marketplace: boolean } }) => unknown) => selector(mockGlobalState),
}))

const mockProviders = [
  {
    provider: 'openai',
    label: { en_US: 'OpenAI' },
    custom_configuration: { status: CustomConfigurationStatusEnum.active },
    system_configuration: {
      enabled: false,
      current_quota_type: CurrentSystemQuotaTypeEnum.free,
      quota_configurations: [mockQuotaConfig],
    },
  },
  {
    provider: 'anthropic',
    label: { en_US: 'Anthropic' },
    custom_configuration: { status: CustomConfigurationStatusEnum.noConfigure },
    system_configuration: {
      enabled: false,
      current_quota_type: CurrentSystemQuotaTypeEnum.free,
      quota_configurations: [mockQuotaConfig],
    },
  },
]

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    modelProviders: mockProviders,
  }),
}))

type MockDefaultModelData = {
  model: string
  provider?: { provider: string }
} | null

const mockDefaultModelState: {
  data: MockDefaultModelData
  isLoading: boolean
} = {
  data: null,
  isLoading: false,
}

vi.mock('./hooks', () => ({
  useDefaultModel: () => mockDefaultModelState,
}))

vi.mock('./install-from-marketplace', () => ({
  default: () => <div data-testid="install-from-marketplace" />,
}))

vi.mock('./provider-added-card', () => ({
  default: ({ provider }: { provider: { provider: string } }) => <div data-testid="provider-card">{provider.provider}</div>,
}))

vi.mock('./provider-added-card/quota-panel', () => ({
  default: () => <div data-testid="quota-panel" />,
}))

vi.mock('./system-model-selector', () => ({
  default: () => <div data-testid="system-model-selector" />,
}))

describe('ModelProviderPage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockGlobalState.systemFeatures.enable_marketplace = true
    mockDefaultModelState.data = null
    mockDefaultModelState.isLoading = false
    mockProviders.splice(0, mockProviders.length, {
      provider: 'openai',
      label: { en_US: 'OpenAI' },
      custom_configuration: { status: CustomConfigurationStatusEnum.active },
      system_configuration: {
        enabled: false,
        current_quota_type: CurrentSystemQuotaTypeEnum.free,
        quota_configurations: [mockQuotaConfig],
      },
    }, {
      provider: 'anthropic',
      label: { en_US: 'Anthropic' },
      custom_configuration: { status: CustomConfigurationStatusEnum.noConfigure },
      system_configuration: {
        enabled: false,
        current_quota_type: CurrentSystemQuotaTypeEnum.free,
        quota_configurations: [mockQuotaConfig],
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should render main elements', () => {
    render(<ModelProviderPage searchText="" />)
    expect(screen.getByText('common.modelProvider.models')).toBeInTheDocument()
    expect(screen.getByTestId('system-model-selector')).toBeInTheDocument()
    expect(screen.getByTestId('install-from-marketplace')).toBeInTheDocument()
  })

  it('should render configured and not configured providers sections', () => {
    render(<ModelProviderPage searchText="" />)
    expect(screen.getByText('openai')).toBeInTheDocument()
    expect(screen.getByText('common.modelProvider.toBeConfigured')).toBeInTheDocument()
    expect(screen.getByText('anthropic')).toBeInTheDocument()
  })

  it('should filter providers based on search text', () => {
    render(<ModelProviderPage searchText="open" />)
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(screen.getByText('openai')).toBeInTheDocument()
    expect(screen.queryByText('anthropic')).not.toBeInTheDocument()
  })

  it('should show empty state if no configured providers match', () => {
    render(<ModelProviderPage searchText="non-existent" />)
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(screen.getByText('common.modelProvider.emptyProviderTitle')).toBeInTheDocument()
  })

  it('should hide marketplace section when marketplace feature is disabled', () => {
    mockGlobalState.systemFeatures.enable_marketplace = false

    render(<ModelProviderPage searchText="" />)

    expect(screen.queryByTestId('install-from-marketplace')).not.toBeInTheDocument()
  })

  it('should prioritize fixed providers in visible order', () => {
    mockProviders.splice(0, mockProviders.length, {
      provider: 'zeta-provider',
      label: { en_US: 'Zeta Provider' },
      custom_configuration: { status: CustomConfigurationStatusEnum.active },
      system_configuration: {
        enabled: false,
        current_quota_type: CurrentSystemQuotaTypeEnum.free,
        quota_configurations: [mockQuotaConfig],
      },
    }, {
      provider: 'langgenius/anthropic/anthropic',
      label: { en_US: 'Anthropic Fixed' },
      custom_configuration: { status: CustomConfigurationStatusEnum.active },
      system_configuration: {
        enabled: false,
        current_quota_type: CurrentSystemQuotaTypeEnum.free,
        quota_configurations: [mockQuotaConfig],
      },
    }, {
      provider: 'langgenius/openai/openai',
      label: { en_US: 'OpenAI Fixed' },
      custom_configuration: { status: CustomConfigurationStatusEnum.noConfigure },
      system_configuration: {
        enabled: true,
        current_quota_type: CurrentSystemQuotaTypeEnum.free,
        quota_configurations: [mockQuotaConfig],
      },
    })

    render(<ModelProviderPage searchText="" />)

    const renderedProviders = screen.getAllByTestId('provider-card').map(item => item.textContent)
    expect(renderedProviders).toEqual([
      'langgenius/openai/openai',
      'langgenius/anthropic/anthropic',
      'zeta-provider',
    ])
    expect(screen.queryByText('common.modelProvider.toBeConfigured')).not.toBeInTheDocument()
  })

  it('should show not configured alert when all default models are absent', () => {
    mockDefaultModelState.data = null
    mockDefaultModelState.isLoading = false

    render(<ModelProviderPage searchText="" />)

    expect(screen.getByText('common.modelProvider.notConfigured')).toBeInTheDocument()
  })

  it('should not show not configured alert when default model is loading', () => {
    mockDefaultModelState.data = null
    mockDefaultModelState.isLoading = true

    render(<ModelProviderPage searchText="" />)

    expect(screen.queryByText('common.modelProvider.notConfigured')).not.toBeInTheDocument()
  })

  it('should filter providers by label text', () => {
    render(<ModelProviderPage searchText="OpenAI" />)
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(screen.getByText('openai')).toBeInTheDocument()
    expect(screen.queryByText('anthropic')).not.toBeInTheDocument()
  })

  it('should classify system-enabled providers with matching quota as configured', () => {
    mockProviders.splice(0, mockProviders.length, {
      provider: 'sys-provider',
      label: { en_US: 'System Provider' },
      custom_configuration: { status: CustomConfigurationStatusEnum.noConfigure },
      system_configuration: {
        enabled: true,
        current_quota_type: CurrentSystemQuotaTypeEnum.free,
        quota_configurations: [mockQuotaConfig],
      },
    })

    render(<ModelProviderPage searchText="" />)

    expect(screen.getByText('sys-provider')).toBeInTheDocument()
    expect(screen.queryByText('common.modelProvider.toBeConfigured')).not.toBeInTheDocument()
  })

  it('should classify system-enabled provider with no matching quota as not configured', () => {
    mockProviders.splice(0, mockProviders.length, {
      provider: 'sys-no-quota',
      label: { en_US: 'System No Quota' },
      custom_configuration: { status: CustomConfigurationStatusEnum.noConfigure },
      system_configuration: {
        enabled: true,
        current_quota_type: CurrentSystemQuotaTypeEnum.free,
        quota_configurations: [],
      },
    })

    render(<ModelProviderPage searchText="" />)

    expect(screen.getByText('sys-no-quota')).toBeInTheDocument()
    expect(screen.getByText('common.modelProvider.toBeConfigured')).toBeInTheDocument()
  })

  it('should preserve order of two non-fixed providers (sort returns 0)', () => {
    mockProviders.splice(0, mockProviders.length, {
      provider: 'alpha-provider',
      label: { en_US: 'Alpha Provider' },
      custom_configuration: { status: CustomConfigurationStatusEnum.active },
      system_configuration: {
        enabled: false,
        current_quota_type: CurrentSystemQuotaTypeEnum.free,
        quota_configurations: [mockQuotaConfig],
      },
    }, {
      provider: 'beta-provider',
      label: { en_US: 'Beta Provider' },
      custom_configuration: { status: CustomConfigurationStatusEnum.active },
      system_configuration: {
        enabled: false,
        current_quota_type: CurrentSystemQuotaTypeEnum.free,
        quota_configurations: [mockQuotaConfig],
      },
    })

    render(<ModelProviderPage searchText="" />)

    const renderedProviders = screen.getAllByTestId('provider-card').map(item => item.textContent)
    expect(renderedProviders).toEqual(['alpha-provider', 'beta-provider'])
  })

  it('should not show not configured alert when shared default model mock has data', () => {
    mockDefaultModelState.data = { model: 'embed-model' }

    render(<ModelProviderPage searchText="" />)

    expect(screen.queryByText('common.modelProvider.notConfigured')).not.toBeInTheDocument()
  })

  it('should not show not configured alert when rerankDefaultModel has data', () => {
    mockDefaultModelState.data = { model: 'rerank-model', provider: { provider: 'cohere' } }
    mockDefaultModelState.isLoading = false

    render(<ModelProviderPage searchText="" />)

    expect(screen.queryByText('common.modelProvider.notConfigured')).not.toBeInTheDocument()
  })

  it('should not show not configured alert when ttsDefaultModel has data', () => {
    mockDefaultModelState.data = { model: 'tts-model', provider: { provider: 'openai' } }
    mockDefaultModelState.isLoading = false

    render(<ModelProviderPage searchText="" />)

    expect(screen.queryByText('common.modelProvider.notConfigured')).not.toBeInTheDocument()
  })

  it('should not show not configured alert when speech2textDefaultModel has data', () => {
    mockDefaultModelState.data = { model: 'whisper', provider: { provider: 'openai' } }
    mockDefaultModelState.isLoading = false

    render(<ModelProviderPage searchText="" />)

    expect(screen.queryByText('common.modelProvider.notConfigured')).not.toBeInTheDocument()
  })
})
