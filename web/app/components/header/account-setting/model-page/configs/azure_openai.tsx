import { ProviderEnum } from '../declarations'
import type { ProviderConfig } from '../declarations'
import { AzureOpenaiService, AzureOpenaiServiceText, OpenaiBlue } from '@/app/components/base/icons/src/public/llm'

const config: ProviderConfig = {
  selector: {
    name: {
      'en': 'Azure OpenAI Service',
      'zh-Hans': 'Azure OpenAI Service',
    },
    icon: <OpenaiBlue className='w-full h-full' />,
  },
  item: {
    key: ProviderEnum.azure_openai,
    titleIcon: {
      'en': <AzureOpenaiServiceText className='h-6' />,
      'zh-Hans': <AzureOpenaiServiceText className='h-6' />,
    },
  },
  modal: {
    key: ProviderEnum.azure_openai,
    title: {
      'en': 'Azure OpenAI Service Model',
      'zh-Hans': 'Azure OpenAI Service Model',
    },
    icon: <AzureOpenaiService className='h-6' />,
    link: {
      href: 'https://azure.microsoft.com/en-us/products/ai-services/openai-service',
      label: {
        'en': 'Get your API key from Azure',
        'zh-Hans': '从 Azure 获取 API Key',
      },
    },
    defaultValue: {
      model_type: 'text-generation',
    },
    validateKeys: [
      'model_name',
      'model_type',
      'openai_api_base',
      'openai_api_key',
      'base_model_name',
    ],
    fields: [
      {
        type: 'text',
        key: 'model_name',
        required: true,
        label: {
          'en': 'Deployment Name',
          'zh-Hans': '部署名称',
        },
        placeholder: {
          'en': 'Enter your Deployment Name here',
          'zh-Hans': '在此输入您的部署名称',
        },
      },
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
        key: 'openai_api_base',
        required: true,
        label: {
          'en': 'API Endpoint URL',
          'zh-Hans': 'API 域名',
        },
        placeholder: {
          'en': 'Enter your API Endpoint, eg: https://example.com/xxx',
          'zh-Hans': '在此输入您的 API 域名，如：https://example.com/xxx',
        },
      },
      {
        type: 'text',
        key: 'openai_api_key',
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
        type: 'select',
        key: 'base_model_name',
        required: true,
        label: {
          'en': 'Base Model',
          'zh-Hans': '基础模型',
        },
        options: (v) => {
          if (v.model_type === 'text-generation') {
            return [
              {
                key: 'gpt-35-turbo',
                label: {
                  'en': 'gpt-35-turbo',
                  'zh-Hans': 'gpt-35-turbo',
                },
              },
              {
                key: 'gpt-35-turbo-16k',
                label: {
                  'en': 'gpt-35-turbo-16k',
                  'zh-Hans': 'gpt-35-turbo-16k',
                },
              },
              {
                key: 'gpt-4',
                label: {
                  'en': 'gpt-4',
                  'zh-Hans': 'gpt-4',
                },
              },
              {
                key: 'gpt-4-32k',
                label: {
                  'en': 'gpt-4-32k',
                  'zh-Hans': 'gpt-4-32k',
                },
              },
              {
                key: 'text-davinci-003',
                label: {
                  'en': 'text-davinci-003',
                  'zh-Hans': 'text-davinci-003',
                },
              },
            ]
          }
          if (v.model_type === 'embeddings') {
            return [
              {
                key: 'text-embedding-ada-002',
                label: {
                  'en': 'text-embedding-ada-002',
                  'zh-Hans': 'text-embedding-ada-002',
                },
              },
            ]
          }
          return []
        },
      },
    ],
  },
}

export default config
