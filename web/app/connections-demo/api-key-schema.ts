import type { ProviderConfig } from '@dify/contracts/api/web/types.gen'

export const demoApiKeySchema: ProviderConfig[] = [
  {
    name: 'api_key',
    type: 'secret-input',
    required: true,
    label: { en_US: 'API Key' },
    placeholder: { en_US: 'Enter API Key' },
  },
]
