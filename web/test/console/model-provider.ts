import type {
  DefaultModelResponse,
  ModelProviderSummaryResponse,
  ProviderModelWithStatusEntity,
  ProviderWithModelsResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import type { ConsoleClient } from '@/service/console'
import {
  zDefaultModelResponse,
  zModelProviderSummaryResponse,
  zProviderWithModelsResponse,
} from '@dify/contracts/api/console/workspaces/zod.gen'
import { consoleQuery } from '@/service/console'

type ProviderResponse = Awaited<
  ReturnType<ConsoleClient['workspaces']['current']['modelProviders']['get']>
>['data'][number]

type ProviderResponseOverrides = Partial<Omit<ProviderResponse, 'custom_configuration'>> & {
  custom_configuration?: Partial<ProviderResponse['custom_configuration']>
}

/** A console model provider list item, as `modelProviders.get` returns it. */
export const createProviderResponseFixture = ({
  custom_configuration,
  ...overrides
}: ProviderResponseOverrides = {}): ProviderResponse => ({
  provider: 'openai',
  tenant_id: 'tenant-1',
  label: { en_US: 'OpenAI' },
  supported_model_types: ['llm'],
  configurate_methods: ['predefined-model'],
  preferred_provider_type: 'custom',
  custom_configuration: { status: 'active', ...custom_configuration },
  system_configuration: { enabled: false, quota_configurations: [] },
  ...overrides,
})

export const createProviderSummaryFixture = ({
  custom_configuration,
  ...overrides
}: Partial<Omit<ModelProviderSummaryResponse, 'custom_configuration'>> & {
  custom_configuration?: Partial<ModelProviderSummaryResponse['custom_configuration']>
} = {}) =>
  zModelProviderSummaryResponse.parse({
    provider: 'openai',
    label: { en_US: 'OpenAI' },
    supported_model_types: ['llm'],
    configurate_methods: ['predefined-model'],
    preferred_provider_type: 'custom',
    plugin_id: 'openai',
    is_configured: true,
    system_configuration: { enabled: false },
    custom_configuration: {
      status: 'active',
      available_credentials: [],
      current_credential_usable: true,
      has_custom_models: false,
      ...custom_configuration,
    },
    ...overrides,
  })

export const createModelCreditsFixture = (): Awaited<
  ReturnType<ConsoleClient['workspaces']['current']['modelProviders']['credits']['get']>
> => ({
  remaining_credits: 100,
  quota_used: 0,
  model_billing_source: 'legacy_message_credits',
  model_billing_migration_status: 'none',
  quota_limit: 100,
  is_exhausted: false,
  is_unlimited: false,
  exhausted_at: null,
  next_credit_reset_date: null,
  pool_type: 'trial',
})

/** Query metadata used by real model selectors and their consuming forms. */
export const seedModelProviderQueries = (
  queryClient: QueryClient,
  providers: ProviderWithModelsResponse[] = [],
) => {
  queryClient.setQueryData(consoleQuery.workspaces.current.modelProviders.summary.get.queryKey(), {
    data: providers.map((provider) =>
      createProviderSummaryFixture({ provider: provider.provider, label: provider.label }),
    ),
    plugins: {},
  })
  queryClient.setQueryData(
    consoleQuery.workspaces.current.modelProviders.credits.get.queryKey(),
    createModelCreditsFixture(),
  )
  for (const model_type of [
    'llm',
    'text-embedding',
    'rerank',
    'speech2text',
    'tts',
    'moderation',
  ] as const) {
    const data = providers
      .map((provider) => ({
        ...provider,
        models: provider.models.filter((model) => model.model_type === model_type),
      }))
      .filter((provider) => provider.models.length > 0)
    queryClient.setQueryData(
      consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
        input: { params: { model_type } },
      }),
      { data: data.map((provider) => zProviderWithModelsResponse.parse(provider)) },
    )
    queryClient.setQueryData(
      consoleQuery.workspaces.current.defaultModel.get.queryKey({
        input: { query: { model_type } },
      }),
      { data: null },
    )
  }
}

export const createCatalogModelFixture = (
  overrides: Partial<ProviderModelWithStatusEntity> = {},
): ProviderModelWithStatusEntity => ({
  model: 'gpt-4',
  label: { en_US: 'GPT-4' },
  model_type: 'llm',
  fetch_from: 'predefined-model',
  status: 'active',
  model_properties: {},
  load_balancing_enabled: false,
  ...overrides,
})

export const createModelCatalogFixture = (
  overrides: Partial<ProviderWithModelsResponse> = {},
): ProviderWithModelsResponse => ({
  tenant_id: 'workspace-1',
  provider: 'openai',
  label: { en_US: 'OpenAI' },
  status: 'active',
  models: [createCatalogModelFixture()],
  ...overrides,
})

/** Default-model response with the provider metadata required by the API. */
export const createDefaultModelFixture = ({
  provider,
  ...overrides
}: Partial<Omit<DefaultModelResponse, 'provider'>> & {
  provider?: Partial<DefaultModelResponse['provider']>
} = {}) =>
  zDefaultModelResponse.parse({
    model: 'gpt-4',
    model_type: 'llm',
    ...overrides,
    provider: {
      provider: 'openai',
      label: { en_US: 'OpenAI' },
      supported_model_types: [overrides.model_type ?? 'llm'],
      tenant_id: 'workspace-1',
      ...provider,
    },
  })
