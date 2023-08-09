import { ModelEnum } from '../declarations'
import type { ModelConfig } from '../declarations'
import { Tongyi, TongyiText, TongyiTextCn } from '@/app/components/base/icons/src/image/llm'

const config: ModelConfig = {
  key: ModelEnum.tongyi,
  item: {
    key: ModelEnum.tongyi,
    titleIcon: {
      'en': <TongyiText className='w-[88px] h-6' />,
      'zh-Hans': <TongyiTextCn className='w-[100px] h-6' />,
    },
  },
  modal: {
    title: {
      'en': 'Tongyi',
      'zh-Hans': '通义千问',
    },
    icon: <Tongyi className='w-6 h-6' />,
    link: {
      href: 'https://docs.dify.ai',
      label: {
        'en': 'Get your API key from AliCloud',
        'zh-Hans': '从阿里云获取 API Key',
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
    ],
  },
}

export default config
