import { ProviderEnum } from '../declarations'
import type { ProviderConfig } from '../declarations'
import { Cohere, CohereText } from '@/app/components/base/icons/src/public/llm'

const config: ProviderConfig = {
  selector: {
    name: {
      'en': 'cohere',
      'zh-Hans': 'cohere',
    },
    icon: <Cohere className='w-full h-full' />,
  },
  item: {
    key: ProviderEnum.cohere,
    titleIcon: {
      'en': <CohereText className='w-[120px] h-6' />,
      'zh-Hans': <CohereText className='w-[120px] h-6' />,
    },
  },
  modal: {
    key: ProviderEnum.cohere,
    title: {
      'en': 'cohere',
      'zh-Hans': 'cohere',
    },
    icon: <Cohere className='w-6 h-6' />,
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
