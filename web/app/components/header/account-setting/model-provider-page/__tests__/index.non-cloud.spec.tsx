import type { ModelProviderSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { screen } from '@testing-library/react'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery as renderOwner,
} from '@/test/console/query-data'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import ModelProviderPage from '../index'

const renderWithConsoleQuery = createNuqsTestRenderer(renderOwner)

const providerSummaryFixture = {
  provider: 'openai',
  plugin_id: 'langgenius/openai',
  label: { en_US: 'OpenAI' },
  configurate_methods: ['predefined-model'],
  supported_model_types: ['llm'],
  preferred_provider_type: 'custom',
  is_configured: true,
  system_configuration: { enabled: false },
  custom_configuration: {
    status: 'active',
    available_credentials: [],
    current_credential_usable: true,
    has_custom_models: false,
  },
} satisfies ModelProviderSummaryResponse

vi.mock('../provider-added-card', () => ({
  default: () => <div data-testid="provider-card" />,
}))

vi.mock('../provider-added-card/quota-panel', () => ({
  default: () => <div data-testid="quota-panel" />,
}))

vi.mock('../install-from-marketplace', () => ({
  default: () => <div data-testid="install-from-marketplace" />,
}))

vi.mock('@/app/components/plugins/plugin-page/use-reference-setting', () => ({
  useCanSetPluginSettings: () => ({
    canSetPermissions: true,
    canSetPluginPreferences: true,
  }),
  usePluginSettingsAccess: () => ({
    canSetPermissions: true,
    canSetPluginPreferences: true,
  }),
  default: () => ({
    referenceSetting: {
      permission: {},
      auto_upgrade: {
        strategy_setting: 'latest',
        upgrade_time_of_day: 0,
        upgrade_mode: 'all',
        exclude_plugins: [],
        include_plugins: [],
      },
    },
    setReferenceSettings: vi.fn(),
  }),
}))

vi.mock('@/service/use-plugins', () => ({
  useInstalledPluginList: () => ({
    data: { plugins: [] },
  }),
  useInvalidateInstalledPluginList: () => vi.fn(),
  useInvalidateCheckInstalled: () => vi.fn(),
  usePluginAutoUpgradeSettings: () => ({
    data: {
      category: 'model',
      auto_upgrade: {
        strategy_setting: 'latest',
        upgrade_time_of_day: 0,
        upgrade_mode: 'all',
        exclude_plugins: [],
        include_plugins: [],
      },
    },
    error: undefined,
    isFetching: false,
    isLoading: false,
  }),
  useMutationPluginAutoUpgradeSettings: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}))

vi.mock('@/app/components/plugins/reference-setting-modal', () => ({
  default: () => <div data-testid="reference-setting-modal" />,
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.modelProviders.summary.get': () => new Promise(() => {}),
      'workspaces.current.plugin.list.latestVersions.post': () => ({ versions: {} }),
    }),
  }
})

const renderPage: typeof renderWithConsoleQuery = (ui, options) => {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient)
  queryClient.setQueryData(consoleQuery.workspaces.current.modelProviders.summary.get.queryKey(), {
    data: [{ ...providerSummaryFixture } satisfies ModelProviderSummaryResponse],
    plugins: {},
  })
  return renderWithConsoleQuery(ui, { ...options, queryClient })
}

describe('ModelProviderPage non-cloud branch', () => {
  it('should skip the quota panel when cloud edition is disabled', () => {
    renderPage(<ModelProviderPage searchText="" />, {
      systemFeatures: { enable_marketplace: false, deployment_edition: 'COMMUNITY' },
    })

    expect(
      screen.getByRole('button', { name: /modelProvider.systemModelSettings/ }),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('quota-panel')).not.toBeInTheDocument()
  })
})
