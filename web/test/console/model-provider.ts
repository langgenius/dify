import type { ModelProviderSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ConsoleClient } from '@/service/console'
import { zModelProviderSummaryResponse } from '@dify/contracts/api/console/workspaces/zod.gen'

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
  quota_limit: 100,
  is_exhausted: false,
  is_unlimited: false,
  exhausted_at: null,
  next_credit_reset_date: null,
  pool_type: 'trial',
})
