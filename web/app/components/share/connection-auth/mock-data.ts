import type { RequiredConnectionService } from '../connections/required-services'

export type ConnectionAuthSource = 'cli' | 'api'

export const mockRequest = {
  app: {
    name: 'Sales Follow-up Assistant',
    description:
      'Research prospects, review customer notes, and send personalized follow-up emails.',
    iconClassName: 'i-ri-asterisk',
    iconBackground: '#FF4405',
  },
  accountEmail: 'alex@northstar.io',
  sources: {
    cli: { requester: 'Dify CLI', identity: 'al••••@northstar.io' },
    api: { requester: 'Acme Assistant', identity: 'Feishu user •••1234' },
  },
}

export function createMockServices(): RequiredConnectionService[] {
  return [
    {
      id: 'gmail',
      name: 'Gmail',
      description: 'Send follow-up emails',
      iconClassName: 'i-custom-public-common-gmail',
      availableConnections: [],
      methods: ['oauth'],
    },
    {
      id: 'notion',
      name: 'Notion',
      description: 'Read customer notes',
      iconClassName: 'i-custom-public-common-notion',
      availableConnections: [],
      methods: ['oauth'],
    },
    {
      id: 'google-search',
      name: 'Google Search',
      description: 'Research prospects',
      iconClassName: 'i-custom-public-plugins-google',
      availableConnections: [],
      methods: ['oauth', 'api-key'],
      apiKeySchema: [
        {
          name: 'api_key',
          type: 'secret-input',
          required: true,
          label: { en_US: 'API Key' },
          placeholder: { en_US: 'sk-...' },
        },
      ],
    },
  ]
}
