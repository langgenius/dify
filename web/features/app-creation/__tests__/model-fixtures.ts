import type {
  DefaultModelResponse,
  ProviderWithModelsResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'

export const promptDefaultModel = {
  model: 'gpt-4.1',
  model_type: 'llm',
  provider: {
    provider: 'openai',
    provider_name: 'OpenAI',
    models: [],
    label: { en_US: 'OpenAI' },
    supported_model_types: ['llm'],
    tenant_id: 'workspace-1',
  },
} satisfies DefaultModelResponse

export const promptModelProviders = [
  {
    provider: 'openai',
    label: { en_US: 'OpenAI' },
    status: 'active',
    tenant_id: 'workspace-1',
    models: [
      {
        deprecated: false,
        has_invalid_load_balancing_configs: false,
        load_balancing_enabled: false,
        model: 'gpt-4.1',
        label: { en_US: 'GPT-4.1' },
        model_type: 'llm',
        fetch_from: 'predefined-model',
        status: 'active',
        model_properties: { mode: 'chat' },
      },
    ],
  },
] satisfies ProviderWithModelsResponse[]
