import { ProviderEnum } from '../declarations'
import type { ProviderConfig } from '../declarations'
import { Minimax, MinimaxText } from '@/app/components/base/icons/src/image/llm'

const config: ProviderConfig = {
  selector: {
    name: {
      'en': 'MINIMAX',
      'zh-Hans': 'MINIMAX',
    },
    icon: <Minimax className='w-full h-full' />,
  },
  item: {
    key: ProviderEnum.minimax,
    titleIcon: {
      'en': <MinimaxText className='w-[84px] h-6' />,
      'zh-Hans': <MinimaxText className='w-[84px] h-6' />,
    },
  },
  modal: {
    key: ProviderEnum.minimax,
    title: {
      'en': 'MiniMax',
      'zh-Hans': 'MiniMax',
    },
    icon: <Minimax className='w-6 h-6' />,
    link: {
      href: 'https://api.minimax.chat/user-center/basic-information/interface-key',
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
