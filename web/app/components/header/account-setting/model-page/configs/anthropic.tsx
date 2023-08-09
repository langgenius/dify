import { ModelEnum } from '../declarations'
import type { FormValue, ModelConfig } from '../declarations'
import { validateModelProviderFn } from '../utils'
import { Anthropic, AnthropicText } from '@/app/components/base/icons/src/public/llm'
import { IS_CE_EDITION } from '@/config'

const config: ModelConfig = {
  key: ModelEnum.anthropic,
  item: {
    key: ModelEnum.anthropic,
    titleIcon: {
      'en': <AnthropicText className='h-5' />,
      'zh-Hans': <AnthropicText className='h-5' />,
    },
    subTitleIcon: <Anthropic className='h-6' />,
    desc: {
      'en': 'Anthropic’s powerful models, such as Claude 2 and Claude Instant.',
      'zh-Hans': 'Anthropic 的强大模型，例如 Claude 2 和 Claude Instant。',
    },
    bgColor: 'bg-[#F0F0EB]',
  },
  modal: {
    key: ModelEnum.anthropic,
    title: {
      'en': 'Anthropic',
      'zh-Hans': 'Anthropic',
    },
    icon: <Anthropic className='h-6' />,
    link: {
      href: 'https://docs.dify.ai',
      label: {
        'en': 'Get your API key from Anthropic',
        'zh-Hans': '从 Anthropic 获取 API Key',
      },
    },
    fields: [
      {
        visible: () => true,
        type: 'text',
        key: 'anthropic_api_key',
        required: true,
        label: {
          'en': 'API Key',
          'zh-Hans': 'API Key',
        },
        placeholder: {
          'en': 'Enter your API key here',
          'zh-Hans': '在此输入您的 API Key',
        },
        validate: {
          before: (v) => {
            if (v?.anthropic_api_key)
              return true
          },
          run: (v) => {
            return validateModelProviderFn(ModelEnum.anthropic, {
              config: v,
            })
          },
        },
        onFocus: (newValue: FormValue, originValue?: FormValue, dispatch?: any) => {
          if (newValue.anthropic_api_key === originValue?.anthropic_api_key)
            dispatch({ ...newValue, anthropic_api_key: '' })
        },
      },
      ...(
        IS_CE_EDITION
          ? [{
            visible: () => true,
            type: 'text',
            key: 'anthropic_api_url',
            required: false,
            label: {
              'en': 'Custom API Domain',
              'zh-Hans': '自定义 API 域名',
            },
            placeholder: {
              'en': 'Enter your API domain, eg: https://example.com/xxx',
              'zh-Hans': '在此输入您的 API 域名，如：https://example.com/xxx',
            },
            help: {
              'en': 'Configurable custom Anthropic API server url.',
              'zh-Hans': '可配置自定义 Anthropic API 服务器地址。',
            },
          }]
          : []
      ),
    ],
  },
}
export default config
