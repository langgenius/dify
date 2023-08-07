export default {
  hit: {
    'en': '🐑 Llama 2 Supported',
    'zh-Hans': '🐑 Llama 2 支持',
  },
  title: {
    'en': 'Azure OpenAI',
    'zh-Hans': 'Azure OpenAI',
  },
  link: {
    href: 'https://docs.dify.ai',
    label: {
      'en': 'Get your API key from Azure',
      'zh-Hans': '从 Azure 获取 API Key',
    },
  },
  fields: [
    {
      visible: () => true,
      type: 'radio',
      key: 'modelType',
      required: true,
      label: {
        'en': 'Model Type',
        'zh-Hans': '模型类型',
      },
      options: [
        {
          key: '1',
          label: {
            'en': 'Text Generation',
            'zh-Hans': '文本生成',
          },
        },
        {
          key: '2',
          label: {
            'en': 'Embeddings',
            'zh-Hans': 'Embeddings',
          },
        },
        {
          key: '3',
          label: {
            'en': 'Speech To Text',
            'zh-Hans': '语音转文字',
          },
        },
      ],
    },
    {
      visible: () => true,
      type: 'text',
      key: 'apiToken',
      required: true,
      obfuscated: true,
      label: {
        'en': 'API Endpoint URL',
        'zh-Hans': 'API 域名',
      },
      placeholder: {
        'en': 'Enter your API Endpoint, eg: https://example.com/xxx',
        'zh-Hans': '在此输入您的 API 域名，如：https://example.com/xxx',
      },
      validate: {
        before: () => {
          return true
        },
        run: () => {
          return Promise.resolve({ status: 'error', message: 'invalid' })
        },
      },
    },
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
        'zh-Hans': 'Enter your API key here',
      },
    },
    {
      visible: () => true,
      type: 'text',
      key: 'modelName',
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
  ],
}
