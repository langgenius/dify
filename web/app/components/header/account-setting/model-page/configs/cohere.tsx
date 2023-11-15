import { ProviderEnum } from '../declarations'
import type { ProviderConfig } from '../declarations'

const config: ProviderConfig = {
  selector: {
    name: {
      'en': 'cohere',
      'zh-Hans': 'cohere',
    },
    icon: <span>co</span>,
  },
  item: {
    key: ProviderEnum.cohere,
    titleIcon: {
      'en': <span>co</span>,
      'zh-Hans': <span>co</span>,
    },
  },
  modal: {
    key: ProviderEnum.cohere,
    title: {
      'en': 'cohere',
      'zh-Hans': 'cohere',
    },
    icon: <span>co</span>,
    link: {
      href: 'https://dashboard.cohere.com/api-keys',
      label: {
        'en': 'Get your API key from cohere',
        'zh-Hans': '从 cohere 获取 API Key',
      },
    },
    validateKeys: ['api_key'],
    fields: [
      {
        type: 'text',
        key: 'api_key',
        required: true,
        label: {
          'en': 'API Key',
          'zh-Hans': 'API Key',
        },
        placeholder: {
          'en': 'Enter your API key here',
          'zh-Hans': '在此输入您的 API Key',
        },
      },
    ],
  },
}

export default config
