export default {
  title: {
    'en': 'Tongyi',
    'zh-Hans': '通义千问',
  },
  link: {
    href: 'https://docs.dify.ai',
    label: {
      'en': 'Get your API key from AliCloud',
      'zh-Hans': '从阿里云获取 API Key',
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
  ],
}
