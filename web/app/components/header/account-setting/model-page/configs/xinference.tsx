import { ProviderEnum } from '../declarations'
import type { ProviderConfig } from '../declarations'
import { XorbitsInference, XorbitsInferenceText } from '@/app/components/base/icons/src/public/llm'

const config: ProviderConfig = {
  selector: {
    name: {
      'en': 'Xinference',
      'zh-Hans': 'Xinference',
    },
    icon: <XorbitsInference className='w-full h-full' />,
  },
  item: {
    key: ProviderEnum.xinference,
    titleIcon: {
      'en': <XorbitsInferenceText className='h-6' />,
      'zh-Hans': <XorbitsInferenceText className='h-6' />,
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
    key: ProviderEnum.xinference,
    title: {
      'en': 'Xinference',
      'zh-Hans': 'Xinference',
    },
    icon: <XorbitsInference className='h-6' />,
    link: {
      href: 'https://github.com/xorbitsai/inference',
      label: {
        'en': 'How to deploy Xinference',
        'zh-Hans': '如何部署 Xinference',
      },
    },
    defaultValue: {
      model_type: 'text-generation',
    },
    validateKeys: [
      'model_type',
      'model_name',
      'server_url',
      'model_uid',
    ],
    fields: [
      {
        type: 'radio',
        key: 'model_type',
        required: true,
        label: {
          'en': 'Model Type',
          'zh-Hans': '模型类型',
        },
        options: [
          {
            key: 'text-generation',
            label: {
              'en': 'Text Generation',
              'zh-Hans': '文本生成',
            },
          },
          {
            key: 'embeddings',
            label: {
              'en': 'Embeddings',
              'zh-Hans': 'Embeddings',
            },
          },
        ],
      },
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
          'en': 'Server Url',
          'zh-Hans': 'Server Url',
        },
        placeholder: {
          'en': 'Enter your Server url, eg: https://example.com/xxx',
          'zh-Hans': '在此输入您的 Server url，如：https://example.com/xxx',
        },
      },
      {
        type: 'text',
        key: 'model_uid',
        required: true,
        label: {
          'en': 'Model UID',
          'zh-Hans': 'Model UID',
        },
        placeholder: {
          'en': 'Enter your Model UID',
          'zh-Hans': '在此输入您的 Model UID',
        },
      },
    ],
  },
}

export default config
