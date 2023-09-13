import { ProviderEnum } from '../declarations'
import type { ProviderConfig } from '../declarations'
import { Zhipuai, ZhipuaiText, ZhipuaiTextCn } from '@/app/components/base/icons/src/public/llm'

const config: ProviderConfig = {
  selector: {
    name: {
      'en': 'ZHIPU AI',
      'zh-Hans': '智谱 AI',
    },
    icon: <Zhipuai className='w-full h-full' />,
  },
  item: {
    key: ProviderEnum.zhipuai,
    titleIcon: {
      'en': <ZhipuaiText className='-ml-1 h-7' />,
      'zh-Hans': <ZhipuaiTextCn className='h-8' />,
    },
  },
  modal: {
    key: ProviderEnum.zhipuai,
    title: {
      'en': 'ZHIPU AI',
      'zh-Hans': '智谱 AI',
    },
    icon: <Zhipuai className='w-6 h-6' />,
    link: {
      href: 'https://open.bigmodel.cn/usercenter/apikeys',
      label: {
        'en': 'Get your API key from ZHIPU AI',
        'zh-Hans': '从智谱 AI 获取 API Key',
      },
    },
    validateKeys: [
      'api_key',
    ],
    fields: [
      {
        type: 'text',
        key: 'api_key',
        required: true,
        label: {
          'en': 'APIKey',
          'zh-Hans': 'APIKey',
        },
        placeholder: {
          'en': 'Enter your APIKey here',
          'zh-Hans': '在此输入您的 APIKey',
        },
      },
    ],
  },
}

export default config
