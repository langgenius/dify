export default {
  type: 'provider',
  title: {
    'en': 'Anthropic',
    'zh-Hans': 'Anthropic',
  },
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
      key: 'apiKey',
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
      visible: () => true,
      type: 'text',
      key: 'customApiDomain',
      required: true,
      switch: true,
      switchKey: 'showCustomApiDomain',
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
    },
  ],
}
