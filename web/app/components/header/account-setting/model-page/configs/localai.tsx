import { ProviderEnum } from '../declarations'
import type { FormValue, ProviderConfig } from '../declarations'
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
      model_type: 'text-generation',
      completion_type: 'completion',
    },
    validateKeys: (v?: FormValue) => {
      if (v?.model_type === 'text-generation') {
        return [
          'model_type',
          'model_name',
          'server_url',
          'completion_type',
        ]
      }
      if (v?.model_type === 'embeddings') {
        return [
          'model_type',
          'model_name',
          'server_url',
        ]
      }
      return []
    },
    filterValue: (v?: FormValue) => {
      let filteredKeys: string[] = []
      if (v?.model_type === 'text-generation') {
        filteredKeys = [
          'model_type',
          'model_name',
          'server_url',
          'completion_type',
        ]
      }
      if (v?.model_type === 'embeddings') {
        filteredKeys = [
          'model_type',
          'model_name',
          'server_url',
        ]
      }
      return filteredKeys.reduce((prev: FormValue, next: string) => {
        prev[next] = v?.[next] || ''
        return prev
      }, {})
    },
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
        hidden: (value?: FormValue) => value?.model_type === 'embeddings',
        type: 'radio',
        key: 'completion_type',
        required: true,
        label: {
          'en': 'Completion Type',
          'zh-Hans': 'Completion Type',
        },
        options: [
          {
            key: 'completion',
            label: {
              'en': 'Completion',
              'zh-Hans': 'Completion',
            },
          },
          {
            key: 'chat_completion',
            label: {
              'en': 'Chat Completion',
              'zh-Hans': 'Chat Completion',
            },
          },
        ],
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
