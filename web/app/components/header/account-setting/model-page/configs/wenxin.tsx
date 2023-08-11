import { ProviderEnum } from '../declarations'
import type { ProviderConfig } from '../declarations'
import { Wxyy, WxyyText, WxyyTextCn } from '@/app/components/base/icons/src/image/llm'

const config: ProviderConfig = {
  selector: {
    name: {
      'en': 'WENXIN YIYAN',
      'zh-Hans': '文心一言',
    },
    icon: <Wxyy className='w-full h-full' />,
  },
  item: {
    key: ProviderEnum.wenxin,
    titleIcon: {
      'en': <WxyyText className='w-[124px] h-6' />,
      'zh-Hans': <WxyyTextCn className='w-[100px] h-6' />,
    },
  },
  modal: {
    key: ProviderEnum.wenxin,
    title: {
      'en': 'WENXINYIYAN',
      'zh-Hans': '文心一言',
    },
    icon: <Wxyy className='w-6 h-6' />,
    link: {
      href: 'https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application',
      label: {
        'en': 'Get your API key from Baidu',
        'zh-Hans': '从百度获取 API Key',
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
