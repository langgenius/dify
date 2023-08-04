export default {
  title: {
    'en': 'ChatGLM',
    'zh-Hans': 'ChatGLM',
  },
  link: {
    href: 'https://docs.dify.ai',
    label: {
      'en': 'How to deploy ChatGLM',
      'zh-Hans': '如何部署 ChatGLM',
    },
  },
  fields: [
    {
      visible: () => true,
      type: 'text',
      key: 'customApiDomain',
      required: true,
      label: {
        'en': 'Custom API Domain',
        'zh-Hans': '自定义 API 域名',
      },
      placeholder: {
        'en': 'Enter your API domain, eg: https://example.com/xxx',
        'zh-Hans': '在此输入您的 API 域名，如：https://example.com/xxx',
      },
    },
  ],
}
