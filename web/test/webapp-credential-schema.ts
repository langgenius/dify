import type { ProviderConfig } from '@dify/contracts/api/web/types.gen'

export const testApiKeySchema: ProviderConfig[] = [
  {
    name: 'api_key',
    type: 'secret-input',
    required: true,
    label: { en_US: 'share.connections.setup.apiKey' },
    placeholder: { en_US: 'Enter API Key' },
  },
]
