import { ModelEnum } from '../declarations'
import type { ModelConfig } from '../declarations'
import { validateModelProviderFn } from '../utils'
import { Minimax, MinimaxText } from '@/app/components/base/icons/src/image/llm'

const config: ModelConfig = {
  key: ModelEnum.minimax,
  item: {
    key: ModelEnum.minimax,
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
    key: ModelEnum.minimax,
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
        key: 'minimax_api_key',
        required: true,
        label: {
          'en': 'API Key',
          'zh-Hans': 'API Key',
        },
        placeholder: {
          'en': 'Enter your API key here',
          'zh-Hans': '在此输入您的 API Key',
        },
        validate: {
          before: (v) => {
            if (v?.minimax_api_key)
              return true
          },
          run: (v) => {
            return validateModelProviderFn(ModelEnum.minimax, {
              config: v,
            })
          },
        },
      },
      {
        visible: () => true,
        type: 'text',
        key: 'minimax_group_id',
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
