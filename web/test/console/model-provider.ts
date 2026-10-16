import type { ConsoleClient } from '@/service/console'

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
