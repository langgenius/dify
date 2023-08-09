import { ModelEnum } from '../declarations'
import type { ModelConfig } from '../declarations'
import { validateModelProviderModelFn } from '../utils'
import { Replicate, ReplicateText } from '@/app/components/base/icons/src/public/llm'

const config: ModelConfig = {
  key: ModelEnum.replicate,
  item: {
    key: ModelEnum.replicate,
    titleIcon: {
      'en': <ReplicateText className='h-6' />,
      'zh-Hans': <ReplicateText className='h-6' />,
    },
    hit: {
      'en': '🐑 Llama 2 Supported',
      'zh-Hans': '🐑 Llama 2 支持',
    },
  },
  modal: {
    key: ModelEnum.replicate,
    title: {
      'en': 'Replicate',
      'zh-Hans': 'Replicate',
    },
    icon: <Replicate className='h-6' />,
    link: {
      href: 'https://docs.dify.ai',
      label: {
        'en': 'Get your API key from Replicate',
        'zh-Hans': '从 Replicate 获取 API Key',
      },
    },
    defaultValue: {
      model_type: 'text-generation',
    },
    fields: [
      {
        visible: () => true,
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
        visible: () => true,
        type: 'text',
        key: 'replicate_api_token',
        required: true,
        obfuscated: true,
        label: {
          'en': 'API Key',
          'zh-Hans': 'API Key',
        },
        placeholder: {
          'en': 'Enter your Replicate API key here',
          'zh-Hans': '在此输入您的 Replicate API Key',
        },
        validate: {
          before: () => {
            return true
          },
          run: (v) => {
            return validateModelProviderModelFn(ModelEnum.replicate, v)
          },
        },
      },
      {
        visible: () => true,
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
        visible: () => true,
        type: 'text',
        key: 'model_version',
        label: {
          'en': 'Model Version',
          'zh-Hans': '模型版本',
        },
        placeholder: {
          'en': 'Enter your Model Version here',
          'zh-Hans': '在此输入您的模型版本',
        },
      },
    ],
  },
}

export default config
