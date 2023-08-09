import { ModelEnum } from '../declarations'
import type { FormValue, ModelConfig } from '../declarations'
import { Huggingface, HuggingfaceText } from '@/app/components/base/icons/src/public/llm'

const config: ModelConfig = {
  key: ModelEnum.huggingface_hub,
  item: {
    key: ModelEnum.huggingface_hub,
    titleIcon: {
      'en': <HuggingfaceText className='h-6' />,
      'zh-Hans': <HuggingfaceText className='h-6' />,
    },
    hit: {
      'en': '🐑 Llama 2 Supported',
      'zh-Hans': '🐑 Llama 2 支持',
    },
  },
  modal: {
    title: {
      'en': 'Hugging Face Hub',
      'zh-Hans': 'Hugging Face Hub',
    },
    icon: <Huggingface className='h-6' />,
    link: {
      href: 'https://docs.dify.ai',
      label: {
        'en': 'Get your API key from Hugging Face Hub',
        'zh-Hans': '从 Hugging Face Hub 获取 API Key',
      },
    },
    defaultValue: {
      modelType: '1',
      endpointType: '1',
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
        type: 'radio',
        key: 'endpointType',
        required: true,
        label: {
          'en': 'Endpoint Type',
          'zh-Hans': '端点类型',
        },
        options: [
          {
            key: '1',
            label: {
              'en': 'Hosted Inference API',
              'zh-Hans': '托管推理 API',
            },
          },
          {
            key: '2',
            label: {
              'en': 'Inference Endpoints',
              'zh-Hans': '自部署推理端点',
            },
          },
        ],
      },
      {
        visible: () => true,
        type: 'text',
        key: 'apiToken',
        required: true,
        obfuscated: true,
        label: {
          'en': 'API Token',
          'zh-Hans': 'API Token',
        },
        placeholder: {
          'en': 'Enter your Hugging Face Hub API Token here',
          'zh-Hans': '在此输入您的 Hugging Face Hub API Token',
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
        visible: (value?: FormValue) => value?.modelType === '1' && value.endpointType === '2',
        type: 'text',
        key: 'endpointUrl',
        label: {
          'en': 'Endpoint URL',
          'zh-Hans': '端点 URL',
        },
        placeholder: {
          'en': 'Enter your Endpoint URL here',
          'zh-Hans': '在此输入您的端点 URL',
        },
      },
      {
        visible: (value?: FormValue) => value?.modelType === '1',
        type: 'radio',
        key: 'taskType',
        required: true,
        label: {
          'en': 'Task Type',
          'zh-Hans': '任务类型',
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
              'en': 'Text to Text Generation',
              'zh-Hans': '文本转文本生成',
            },
          },
        ],
      },
    ],
  },
}

export default config
