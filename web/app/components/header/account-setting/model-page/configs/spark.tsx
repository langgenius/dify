import { ProviderEnum } from '../declarations'
import type { ProviderConfig } from '../declarations'
import { IflytekSpark, IflytekSparkText, IflytekSparkTextCn } from '@/app/components/base/icons/src/public/llm'

const config: ProviderConfig = {
  selector: {
    name: {
      'en': 'iFLYTEK SPARK',
      'zh-Hans': '讯飞星火',
    },
    icon: <IflytekSpark className='w-full h-full' />,
  },
  item: {
    key: ProviderEnum.spark,
    titleIcon: {
      'en': <IflytekSparkText className='h-6' />,
      'zh-Hans': <IflytekSparkTextCn className='h-6' />,
    },
  },
  modal: {
    key: ProviderEnum.spark,
    title: {
      'en': 'iFLYTEK SPARK',
      'zh-Hans': '讯飞星火',
    },
    icon: <IflytekSpark className='w-6 h-6' />,
    link: {
      href: 'https://www.xfyun.cn/solutions/xinghuoAPI',
      label: {
        'en': 'Get your API key from iFLYTEK SPARK',
        'zh-Hans': '从讯飞星火获取 API Key',
      },
    },
    validateKeys: [
      'app_id',
      'api_key',
      'api_secret',
    ],
    fields: [
      {
        type: 'text',
        key: 'app_id',
        required: true,
        label: {
          'en': 'APPID',
          'zh-Hans': 'APPID',
        },
        placeholder: {
          'en': 'Enter your APPID here',
          'zh-Hans': '在此输入您的 APPID',
        },
      },
      {
        type: 'text',
        key: 'api_secret',
        required: true,
        label: {
          'en': 'APISecret',
          'zh-Hans': 'APISecret',
        },
        placeholder: {
          'en': 'Enter your APISecret here',
          'zh-Hans': '在此输入您的 APISecret',
        },
      },
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
