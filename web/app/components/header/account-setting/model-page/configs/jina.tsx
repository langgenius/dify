import { ProviderEnum } from '../declarations'
import type { ProviderConfig } from '../declarations'
import { Jina, JinaText } from '@/app/components/base/icons/src/public/llm'

const config: ProviderConfig = {
  selector: {
    name: {
      'en': 'Jina AI',
      'zh-Hans': 'Jina AI',
    },
    icon: <Jina className='w-full h-full' />,
  },
  item: {
    key: ProviderEnum.jina,
    titleIcon: {
      'en': <JinaText className='w-[58px] h-6' />,
      'zh-Hans': <JinaText className='w-[58px] h-6' />,
    },
    hit: {
      'en': 'Embedding Model Supported',
      'zh-Hans': '支持 Embedding 模型',
    },
  },
  modal: {
    key: ProviderEnum.jina,
    title: {
      'en': 'Embedding Model',
      'zh-Hans': 'Embedding 模型',
    },
    icon: <JinaText className='w-[58px] h-6' />,
    link: {
      href: 'https://jina.ai/embeddings/',
      label: {
        'en': 'Get your API key from Jina AI',
        'zh-Hans': '从 Jina AI 获取 API Key',
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
