import { act, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import {
  CurrentSystemQuotaTypeEnum,
  CustomConfigurationStatusEnum,
  QuotaUnitEnum,
} from '../declarations'
import ModelProviderPage from '../index'

const mockQuotaConfig = {
  quota_type: CurrentSystemQuotaTypeEnum.free,
  quota_unit: QuotaUnitEnum.times,
  quota_limit: 100,
  quota_used: 1,
  last_used: 0,
  is_valid: true,
}

const renderModelProviderPage = (
  props: { searchText?: string, enableMarketplace?: boolean } = {},
) => {
  const { searchText = '', enableMarketplace = true } = props
  return renderWithSystemFeatures(<ModelProviderPage searchText={searchText} />, {
    systemFeatures: { enable_marketplace: enableMarketplace },
  })
}

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

const mockDefaultModels: Record<string, { data: unknown, isLoading: boolean }> = {
  'llm': { data: null, isLoading: false },
  'text-embedding': { data: null, isLoading: false },
  'rerank': { data: null, isLoading: false },
  'speech2text': { data: null, isLoading: false },
  'tts': { data: null, isLoading: false },
}

vi.mock('../hooks', () => ({
  useDefaultModel: (type: string) => mockDefaultModels[type] ?? { data: null, isLoading: false },
}))

vi.mock('../install-from-marketplace', () => ({
  default: () => <div data-testid="install-from-marketplace" />,
}))

vi.mock('../provider-added-card', () => ({
  default: ({ provider }: { provider: { provider: string } }) => <div data-testid="provider-card">{provider.provider}</div>,
}))

vi.mock('../provider-added-card/quota-panel', () => ({
  default: () => <div data-testid="quota-panel" />,
}))

vi.mock('../system-model-selector', () => ({
  default: () => <div data-testid="system-model-selector" />,
}))

vi.mock('@/service/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/client')>()
  const originalPlugins = actual.consoleQuery.plugins as unknown as Record<string, unknown>
  return {
    ...actual,
    consoleQuery: new Proxy(actual.consoleQuery, {
      get(target, prop) {
        if (prop === 'plugins') {
          return {
            ...originalPlugins,
            checkInstalled: {
              queryOptions: () => ({
                queryKey: ['plugins', 'checkInstalled'],
                queryFn: () => new Promise(() => {}),
              }),
            },
            latestVersions: {
              queryOptions: () => ({
                queryKey: ['plugins', 'latestVersions'],
                queryFn: () => new Promise(() => {}),
              }),
            },
          }
        }
        return Reflect.get(target, prop)
      },
    }),
  }
})

describe('ModelProviderPage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    Object.keys(mockDefaultModels).forEach((key) => {
      mockDefaultModels[key] = { data: null, isLoading: false }
    })
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
    renderModelProviderPage()
    expect(screen.getByText('common.modelProvider.models')).toBeInTheDocument()
    expect(screen.getByTestId('system-model-selector')).toBeInTheDocument()
    expect(screen.getByTestId('install-from-marketplace')).toBeInTheDocument()
  })

  it('should render configured and not configured providers sections', () => {
    renderModelProviderPage()
    expect(screen.getByText('openai')).toBeInTheDocument()
    expect(screen.getByText('common.modelProvider.toBeConfigured')).toBeInTheDocument()
    expect(screen.getByText('anthropic')).toBeInTheDocument()
  })

  it('should filter providers based on search text', () => {
    renderModelProviderPage({ searchText: 'open' })
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(screen.getByText('openai')).toBeInTheDocument()
    expect(screen.queryByText('anthropic')).not.toBeInTheDocument()
  })

  it('should show empty state if no configured providers match', () => {
    renderModelProviderPage({ searchText: 'non-existent' })
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(screen.getByText('common.modelProvider.emptyProviderTitle')).toBeInTheDocument()
  })

  it('should hide marketplace section when marketplace feature is disabled', () => {
    renderModelProviderPage({ enableMarketplace: false })

    expect(screen.queryByTestId('install-from-marketplace')).not.toBeInTheDocument()
  })

  describe('system model config status', () => {
    it('should not show top warning when no configured providers exist (empty state card handles it)', () => {
      mockProviders.splice(0, mockProviders.length, {
        provider: 'anthropic',
        label: { en_US: 'Anthropic' },
        custom_configuration: { status: CustomConfigurationStatusEnum.noConfigure },
        system_configuration: {
          enabled: false,
          current_quota_type: CurrentSystemQuotaTypeEnum.free,
          quota_configurations: [mockQuotaConfig],
        },
      })

      renderModelProviderPage()
      expect(screen.queryByText('common.modelProvider.noneConfigured')).not.toBeInTheDocument()
      expect(screen.queryByText('common.modelProvider.notConfigured')).not.toBeInTheDocument()
      expect(screen.getByText('common.modelProvider.emptyProviderTitle')).toBeInTheDocument()
    })

    it('should show none-configured warning when providers exist but no default models set', () => {
      renderModelProviderPage()
      expect(screen.getByText('common.modelProvider.noneConfigured')).toBeInTheDocument()
    })

    it('should show partially-configured warning when some default models are set', () => {
      mockDefaultModels.llm = {
        data: { model: 'gpt-4', model_type: 'llm', provider: { provider: 'openai', icon_small: { en_US: '' } } },
        isLoading: false,
      }

      renderModelProviderPage()
      expect(screen.getByText('common.modelProvider.notConfigured')).toBeInTheDocument()
    })

    it('should not show warning when all default models are configured', () => {
      const makeModel = (model: string, type: string) => ({
        data: { model, model_type: type, provider: { provider: 'openai', icon_small: { en_US: '' } } },
        isLoading: false,
      })
      mockDefaultModels.llm = makeModel('gpt-4', 'llm')
      mockDefaultModels['text-embedding'] = makeModel('text-embedding-3', 'text-embedding')
      mockDefaultModels.rerank = makeModel('rerank-v3', 'rerank')
      mockDefaultModels.speech2text = makeModel('whisper-1', 'speech2text')
      mockDefaultModels.tts = makeModel('tts-1', 'tts')

      renderModelProviderPage()
      expect(screen.queryByText('common.modelProvider.noProviderInstalled')).not.toBeInTheDocument()
      expect(screen.queryByText('common.modelProvider.noneConfigured')).not.toBeInTheDocument()
      expect(screen.queryByText('common.modelProvider.notConfigured')).not.toBeInTheDocument()
    })

    it('should not show warning while loading', () => {
      Object.keys(mockDefaultModels).forEach((key) => {
        mockDefaultModels[key] = { data: null, isLoading: true }
      })

      renderModelProviderPage()
      expect(screen.queryByText('common.modelProvider.noProviderInstalled')).not.toBeInTheDocument()
      expect(screen.queryByText('common.modelProvider.noneConfigured')).not.toBeInTheDocument()
      expect(screen.queryByText('common.modelProvider.notConfigured')).not.toBeInTheDocument()
    })
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

    renderModelProviderPage()

    const renderedProviders = screen.getAllByTestId('provider-card').map(item => item.textContent)
    expect(renderedProviders).toEqual([
      'langgenius/openai/openai',
      'langgenius/anthropic/anthropic',
      'zeta-provider',
    ])
    expect(screen.queryByText('common.modelProvider.toBeConfigured')).not.toBeInTheDocument()
  })
})
