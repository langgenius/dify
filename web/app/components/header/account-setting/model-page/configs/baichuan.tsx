import { ProviderEnum } from '../declarations'
import type { ProviderConfig } from '../declarations'
import { BaichuanTextCn } from '@/app/components/base/icons/src/image/llm'
import {
  Baichuan,
  BaichuanText,
} from '@/app/components/base/icons/src/public/llm'

const config: ProviderConfig = {
  selector: {
    name: {
      'en': 'BAICHUAN AI',
      'zh-Hans': '百川智能',
    },
    icon: <Baichuan className='w-full h-full' />,
  },
  item: {
    key: ProviderEnum.baichuan,
    titleIcon: {
      'en': <BaichuanText className='w-[124px] h-6' />,
      'zh-Hans': <BaichuanTextCn className='w-[100px] h-6' />,
    },
  },
  modal: {
    key: ProviderEnum.baichuan,
    title: {
      'en': 'BAICHUAN AI',
      'zh-Hans': '百川智能',
    },
    icon: <Baichuan className='w-6 h-6' />,
    link: {
      href: 'https://platform.baichuan-ai.com/console/apikey',
      label: {
        'en': 'Get your API key from BAICHUAN AI',
        'zh-Hans': '从百川智能获取 API Key',
      },
    },
    validateKeys: ['api_key', 'secret_key'],
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
      {
        type: 'text',
        key: 'secret_key',
        required: true,
        label: {
          'en': 'Secret Key',
          'zh-Hans': 'Secret Key',
        },
        placeholder: {
          'en': 'Enter your Secret key here',
          'zh-Hans': '在此输入您的 Secret Key',
        },
      },
    ],
  },
}

export default config
