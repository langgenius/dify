import { ModelEnum } from '../declarations'
import type { ModelConfig } from '../declarations'
import { Replicate, ReplicateText } from '@/app/components/base/icons/src/public/llm'

const config: ModelConfig = {
  key: ModelEnum.replicate,
  item: {
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
    fields: [
      {
        visible: () => true,
        type: 'radio',
        key: 'modelType',
        required: true,
        label: {
          'en': 'Model Type',
          'zh-Hans': '模型类型',
        },
        options: [
          {
            key: '1',
            label: {
              'en': 'Text Generation',
              'zh-Hans': '文本生成',
            },
          },
          {
            key: '2',
            label: {
              'en': 'Embeddings',
              'zh-Hans': 'Embeddings',
            },
          },
          {
            key: '3',
            label: {
              'en': 'Speech To Text',
              'zh-Hans': '语音转文字',
            },
          },
        ],
      },
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
          'en': 'Enter your Replicate API key here',
          'zh-Hans': '在此输入您的 Replicate API Key',
        },
      },
      {
        visible: () => true,
        type: 'text',
        key: 'modelName',
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
        key: 'modelVersion',
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
