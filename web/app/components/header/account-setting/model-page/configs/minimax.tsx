import { ProviderEnum } from '../declarations'
import type { ProviderConfig } from '../declarations'
import { Minimax, MinimaxText } from '@/app/components/base/icons/src/image/llm'

const config: ProviderConfig = {
  item: {
    key: ProviderEnum.minimax,
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
    key: ProviderEnum.minimax,
    title: {
      'en': 'Setup MiniMax',
      'zh-Hans': '设置 MiniMax',
    },
    icon: <Minimax className='w-6 h-6' />,
    link: {
      href: 'https://docs.dify.ai',
      label: {
        'en': 'Get your API key from MiniMax',
        'zh-Hans': '从 MiniMax 获取 API Key',
      },
    },
    validateKeys: [
      'minimax_api_key',
      'minimax_group_id',
    ],
    fields: [
      {
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
      },
      {
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
