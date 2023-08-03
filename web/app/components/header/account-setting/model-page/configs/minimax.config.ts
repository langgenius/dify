export default {
  title: {
    'en': 'MiniMax',
    'zh-Hans': 'MiniMax',
  },
  link: {
    href: 'https://docs.dify.ai',
    label: {
      'en': 'Get your API key from MiniMax',
      'zh-Hans': '从 MiniMax 获取 API Key',
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
      key: 'groupId',
      required: true,
      label: {
        'en': 'Group ID',
        'zh-Hans': 'Group ID',
      },
      placeholder: {
        'en': 'Enter your Group ID here',
        'zh-Hans': '在此输入您的 Group ID',
      },
    },
  ],
}
