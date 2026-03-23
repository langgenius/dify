import { render, screen } from '@testing-library/react'
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

vi.mock('@/config', () => ({
  IS_CLOUD_EDITION: false,
}))

vi.mock('@/context/global-public-context', () => ({
  useSystemFeaturesQuery: () => ({
    data: {
      enable_marketplace: false,
    },
  }),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    modelProviders: [{
      provider: 'openai',
      label: { en_US: 'OpenAI' },
      custom_configuration: { status: CustomConfigurationStatusEnum.active },
      system_configuration: {
        enabled: false,
        current_quota_type: CurrentSystemQuotaTypeEnum.free,
        quota_configurations: [mockQuotaConfig],
      },
    }],
  }),
}))

vi.mock('../hooks', () => ({
  useDefaultModel: () => ({ data: null, isLoading: false }),
}))

vi.mock('../provider-added-card', () => ({
  default: () => <div data-testid="provider-card" />,
}))

vi.mock('../provider-added-card/quota-panel', () => ({
  default: () => <div data-testid="quota-panel" />,
}))

vi.mock('../system-model-selector', () => ({
  default: () => <div data-testid="system-model-selector" />,
}))

vi.mock('../install-from-marketplace', () => ({
  default: () => <div data-testid="install-from-marketplace" />,
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQuery: () => ({ data: undefined }),
  }
})

vi.mock('@/service/client', () => ({
  consoleQuery: {
    plugins: {
      checkInstalled: { queryOptions: () => ({}) },
      latestVersions: { queryOptions: () => ({}) },
    },
  },
}))

describe('ModelProviderPage non-cloud branch', () => {
  it('should skip the quota panel when cloud edition is disabled', () => {
    render(<ModelProviderPage searchText="" />)

    expect(screen.getByTestId('system-model-selector')).toBeInTheDocument()
    expect(screen.queryByTestId('quota-panel')).not.toBeInTheDocument()
  })
})
