import type { ModelProvider } from '@/app/components/header/account-setting/model-provider-page/declarations'

export const createModelProviderFixture = (
  overrides: Partial<ModelProvider> = {},
): ModelProvider => ({
  provider: 'langgenius/openai/openai',
  label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
  supported_model_types: [],
  configurate_methods: [],
  preferred_provider_type: 'custom',
  custom_configuration: { status: 'active', available_credentials: [] },
  system_configuration: { enabled: false, quota_configurations: [] },
  ...overrides,
})
