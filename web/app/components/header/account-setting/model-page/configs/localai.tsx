import { ProviderEnum } from '../declarations'
import type { ProviderConfig } from '../declarations'
import { Localai, LocalaiText } from '@/app/components/base/icons/src/public/llm'

const config: ProviderConfig = {
  selector: {
    name: {
      'en': 'LocalAI',
      'zh-Hans': 'LocalAI',
    },
    icon: <Localai className='w-full h-full' />,
  },
  item: {
    key: ProviderEnum.localai,
    titleIcon: {
      'en': <LocalaiText className='h-6' />,
      'zh-Hans': <LocalaiText className='h-6' />,
    },
    disable: {
      tip: {
        'en': 'Only supports the ',
        'zh-Hans': '仅支持',
      },
      link: {
        href: {
          'en': 'https://docs.dify.ai/getting-started/install-self-hosted',
          'zh-Hans': 'https://docs.dify.ai/v/zh-hans/getting-started/install-self-hosted',
        },
        label: {
          'en': 'community open-source version',
          'zh-Hans': '社区开源版本',
        },
      },
    },
  },
  modal: {
    key: ProviderEnum.localai,
    title: {
      'en': 'LocalAI',
      'zh-Hans': 'LocalAI',
    },
    icon: <Localai className='h-6' />,
    link: {
      href: 'https://github.com/go-skynet/LocalAI',
      label: {
        'en': 'How to deploy LocalAI',
        'zh-Hans': '如何部署 LocalAI',
      },
    },
    defaultValue: {
      model_type: 'embeddings',
    },
    validateKeys: [
      'model_type',
      'model_name',
      'server_url',
    ],
    fields: [
      {
        type: 'text',
        key: 'model_name',
        required: true,
        label: {
          'en': 'Model Name',
          'zh-Hans': '模型名称',
        },
        placeholder: {
          'en': 'Enter your Model Name here',
          'zh-Hans': '在此输入您的模型名称',
        },
      },
      {
        type: 'text',
        key: 'server_url',
        required: true,
        label: {
          'en': 'Server url',
          'zh-Hans': 'Server url',
        },
        placeholder: {
          'en': 'Enter your Server Url, eg: https://example.com/xxx',
          'zh-Hans': '在此输入您的 Server Url，如：https://example.com/xxx',
        },
      },
    ],
  },
}

export default config
