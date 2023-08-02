export default {
  type: 'provider',
  title: {
    'en-US': 'OpenAI',
    'zh-Hans': 'OpenAI',
  },
  link: {
    href: 'https://docs.dify.ai',
    label: {
      'en-US': 'Get your API key from OpenAI',
      'zh-Hans': '从 OpenAI 获取 API Key',
    },
  },
  fields: [
    {
      type: 'text',
      key: 'openai_api_key',
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
      key: 'openai_api_base',
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
        'en-US': 'You can configure your server compatible with the OpenAI API specification, or proxy mirror address',
        'zh-Hans': '可配置您的兼容 OpenAI API 规范的服务器，或者代理镜像地址',
      },
    },
    {
      type: 'text',
      key: 'openai_organization',
      is_required: false,
      toggle_enabled: true,
      label: {
        'en-US': 'Organization ID',
        'zh-Hans': '组织 ID',
      },
      place_holder: {
        'en-US': 'Enter your Organization ID, eg: org-xxxxxxxxxxxxxxxx',
        'zh-Hans': '在此输入您的组织 ID，如：org-xxxxxxxxxxxxxxxx',
      },
    },
  ],
}
