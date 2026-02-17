import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CustomConfigurationStatusEnum } from './declarations'
import ModelProviderPage from './index'

// Mock dependencies
vi.mock('ahooks', () => ({
  useDebounce: (value: unknown) => value,
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    mutateCurrentWorkspace: vi.fn(),
    isValidatingCurrentWorkspace: false,
  }),
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (s: { systemFeatures: { enable_marketplace: boolean } }) => unknown) => selector({
    systemFeatures: { enable_marketplace: true },
  }),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    modelProviders: [
      {
        provider: 'openai',
        label: { en_US: 'OpenAI' },
        custom_configuration: { status: CustomConfigurationStatusEnum.active },
        system_configuration: { enabled: false, quota_configurations: [] },
      },
      {
        provider: 'anthropic',
        label: { en_US: 'Anthropic' },
        custom_configuration: { status: CustomConfigurationStatusEnum.noConfigure },
        system_configuration: { enabled: false, quota_configurations: [] },
      },
    ],
  }),
}))

vi.mock('./hooks', () => ({
  useDefaultModel: () => ({
    data: null,
    isLoading: false,
  }),
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
    vi.clearAllMocks()
  })

  it('should render main elements', () => {
    render(<ModelProviderPage searchText="" />)
    expect(screen.getByText('common.modelProvider.models')).toBeInTheDocument()
    expect(screen.getByTestId('system-model-selector')).toBeInTheDocument()
    expect(screen.getByTestId('install-from-marketplace')).toBeInTheDocument()
  })

  it('should render configured providers', () => {
    render(<ModelProviderPage searchText="" />)
    expect(screen.getByText('openai')).toBeInTheDocument()
  })

  it('should render not configured providers section', () => {
    render(<ModelProviderPage searchText="" />)
    expect(screen.getByText('common.modelProvider.toBeConfigured')).toBeInTheDocument()
    expect(screen.getByText('anthropic')).toBeInTheDocument()
  })

  it('should filter providers based on search text', async () => {
    render(<ModelProviderPage searchText="open" />)
    expect(screen.getByText('openai')).toBeInTheDocument()
    expect(screen.queryByText('anthropic')).not.toBeInTheDocument()
  })

  it('should show empty state if no configured providers match', () => {
    render(<ModelProviderPage searchText="non-existent" />)
    expect(screen.getByText('common.modelProvider.emptyProviderTitle')).toBeInTheDocument()
  })
})
