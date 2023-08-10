import { ProviderEnum } from '../declarations'
import type { FormValue, ProviderConfig } from '../declarations'
import { Huggingface, HuggingfaceText } from '@/app/components/base/icons/src/public/llm'

const config: ProviderConfig = {
  item: {
    key: ProviderEnum.huggingface_hub,
    titleIcon: {
      'en': <HuggingfaceText className='h-6' />,
      'zh-Hans': <HuggingfaceText className='h-6' />,
    },
    hit: {
      'en': '🐑 Llama 2 Supported',
      'zh-Hans': '🐑 Llama 2 已支持',
    },
  },
  modal: {
    key: ProviderEnum.huggingface_hub,
    title: {
      'en': 'Create Hugging Face Model',
      'zh-Hans': '创建 Hugging Face Model',
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
      model_type: 'text-generation',
      huggingfacehub_api_type: 'hosted_inference_api',
    },
    validateKeys: [
      'huggingfacehub_api_type',
      'huggingfacehub_api_token',
      'huggingfacehub_endpoint_url',
      'model_name',
    ],
    fields: [
      {
        type: 'radio',
        key: 'huggingfacehub_api_type',
        required: true,
        label: {
          'en': 'Endpoint Type',
          'zh-Hans': '端点类型',
        },
        options: [
          {
            key: 'hosted_inference_api',
            label: {
              'en': 'Hosted Inference API',
              'zh-Hans': '托管推理 API',
            },
          },
          {
            key: 'inference_endpoints',
            label: {
              'en': 'Inference Endpoints',
              'zh-Hans': '自部署推理端点',
            },
          },
        ],
      },
      {
        type: 'text',
        key: 'huggingfacehub_api_token',
        required: true,
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
        hidden: (value?: FormValue) => value?.huggingfacehub_api_type === 'inference_endpoints',
        type: 'text',
        key: 'huggingfacehub_endpoint_url',
        label: {
          'en': 'Endpoint URL',
          'zh-Hans': '端点 URL',
        },
        placeholder: {
          'en': 'Enter your Endpoint URL here',
          'zh-Hans': '在此输入您的端点 URL',
        },
      },
    ],
  },
}

export default config
