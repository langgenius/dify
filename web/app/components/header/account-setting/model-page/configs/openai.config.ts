export default {
  title: {
    'en': 'OpenAI',
    'zh-Hans': 'OpenAI',
  },
  link: {
    href: 'https://docs.dify.ai',
    label: {
      'en': 'Get your API key from OpenAI',
      'zh-Hans': '从 OpenAI 获取 API Key',
    },
  },
  fields: [
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
        'en': 'Enter your API key here',
        'zh-Hans': '在此输入您的 API Key',
      },
    },
    {
      visible: () => true,
      type: 'text',
      key: 'customApiDomain',
      required: false,
      switch: true,
      label: {
        'en': 'Custom API Domain',
        'zh-Hans': '自定义 API 域名',
      },
      placeholder: {
        'en': 'Enter your API domain, eg: https://example.com/xxx',
        'zh-Hans': '在此输入您的 API 域名，如：https://example.com/xxx',
      },
      help: {
        'en': 'You can configure your server compatible with the OpenAI API specification, or proxy mirror address',
        'zh-Hans': '可配置您的兼容 OpenAI API 规范的服务器，或者代理镜像地址',
      },
    },
  ],
}
