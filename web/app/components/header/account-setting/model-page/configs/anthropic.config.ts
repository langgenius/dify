export default {
  type: 'provider',
  title: {
    'en-US': 'Anthropic',
    'zh-Hans': 'Anthropic',
  },
  link: {
    href: 'https://docs.dify.ai',
    label: {
      'en-US': 'Get your API key from Anthropic',
      'zh-Hans': '从 Anthropic 获取 API Key',
    },
  },
  fields: [
    {
      type: 'text',
      key: 'anthropic_api_key',
      is_required: true,
      toggle_enabled: false,
      is_obfuscated: true,
      label: {
        'en-US': 'API Key',
        'zh-Hans': 'API Key',
      },
      place_holder: {
        'en-US': 'Enter your API key here',
        'zh-Hans': '在此输入您的 API Key',
      },
    },
    {
      type: 'text',
      key: 'anthropic_api_url',
      is_required: false,
      toggle_enabled: true,
      label: {
        'en-US': 'Custom API Domain',
        'zh-Hans': '自定义 API 域名',
      },
      place_holder: {
        'en-US': 'Enter your API domain, eg: https://example.com/xxx',
        'zh-Hans': '在此输入您的 API 域名，如：https://example.com/xxx',
      },
      help: {
        'en-US': 'Configurable custom Anthropic API server url.',
        'zh-Hans': '可配置自定义 Anthropic API 服务器地址。',
      },
    },
  ],
}
