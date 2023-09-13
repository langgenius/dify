import { ProviderEnum } from '../declarations'
import type { ProviderConfig } from '../declarations'
import { IflytekSpark, IflytekSparkText, IflytekSparkTextCn } from '@/app/components/base/icons/src/public/llm'

const config: ProviderConfig = {
  selector: {
    name: {
      'en': 'ZHIPU AI',
      'zh-Hans': '智谱 AI',
    },
    icon: <IflytekSpark className='w-full h-full' />,
  },
  item: {
    key: ProviderEnum.zhipuai,
    titleIcon: {
      'en': <IflytekSparkText className='h-6' />,
      'zh-Hans': <IflytekSparkTextCn className='h-6' />,
    },
  },
  modal: {
    key: ProviderEnum.zhipuai,
    title: {
      'en': 'ZHIPU AI',
      'zh-Hans': '智谱 AI',
    },
    icon: <IflytekSpark className='w-6 h-6' />,
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
