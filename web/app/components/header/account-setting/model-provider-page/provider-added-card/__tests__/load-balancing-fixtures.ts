import type { ModelCredential, ModelItem, ModelProvider } from '../../declarations'

export const label = {
  en_US: 'A model with a sufficiently long display name',
  zh_Hans: 'Test model',
}
export const provider: ModelProvider = {
  provider: 'test/provider',
  label: { en_US: 'Test provider', zh_Hans: 'Test provider' },
  help: { title: label, url: { en_US: '', zh_Hans: '' } },
  icon_small: { en_US: '', zh_Hans: '' },
  supported_model_types: ['llm'],
  configurate_methods: ['predefined-model'],
  provider_credential_schema: { credential_form_schemas: [] },
  model_credential_schema: { model: { label, placeholder: label }, credential_form_schemas: [] },
  preferred_provider_type: 'custom',
  custom_configuration: { status: 'active' },
  system_configuration: { enabled: false, current_quota_type: 'trial', quota_configurations: [] },
}
export const model: ModelItem = {
  model: 'test-model',
  label,
  model_type: 'llm',
  fetch_from: 'predefined-model',
  status: 'active',
  model_properties: {},
  load_balancing_enabled: false,
}
export const credential: ModelCredential = {
  credentials: {},
  load_balancing: { enabled: false, configs: [] },
  available_credentials: [],
}
