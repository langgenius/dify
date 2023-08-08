import { ModelEnum } from '../declarations'
import type { ModelConfig } from '../declarations'
import { Minimax, MinimaxText } from '@/app/components/base/icons/src/image/llm'

const config: ModelConfig = {
  key: ModelEnum.minimax,
  item: {
    titleIcon: {
      'en': <MinimaxText className='w-[84px] h-6' />,
      'zh-Hans': <MinimaxText className='w-[84px] h-6' />,
    },
    vender: {
      'en': 'Earn 1 million tokens for free',
      'zh-Hans': '免费获取 100 万个 token',
    },
  },
  modal: {
    title: {
      'en': 'MiniMax',
      'zh-Hans': 'MiniMax',
    },
    icon: <Minimax className='w-6 h-6' />,
    link: {
      href: 'https://docs.dify.ai',
      label: {
        'en': 'Get your API key from MiniMax',
        'zh-Hans': '从 MiniMax 获取 API Key',
      },
    },
    fields: [
      {
        visible: () => true,
        type: 'text',
        key: 'apiKey',
        required: true,
        obfuscated: true,
        label: {
          'en': 'API Key',
          'zh-Hans': 'API Key',
        },
        placeholder: {
          'en': 'Enter your API key here',
          'zh-Hans': '在此输入您的 API Key',
        },
      },
      {
        visible: () => true,
        type: 'text',
        key: 'groupId',
        required: true,
        label: {
          'en': 'Group ID',
          'zh-Hans': 'Group ID',
        },
        placeholder: {
          'en': 'Enter your Group ID here',
          'zh-Hans': '在此输入您的 Group ID',
        },
      },
    ],
  },
}

export default config
