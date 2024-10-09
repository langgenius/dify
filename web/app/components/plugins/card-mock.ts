import { PluginType } from './types'

export const toolNotion = {
  type: PluginType.tool,
  org: 'Notion',
  name: 'notion page search',
  latest_version: '1.0.0',
  icon: 'https://via.placeholder.com/150',
  label: {
    'en-US': 'Notion Page Search',
    'zh-Hans': 'Notion 页面搜索',
  },
  brief: {
    'en-US': 'Description: Search Notion pages and open visited ones faster. No admin access required.',
    'zh-Hans': '搜索 Notion 页面并更快地打开已访问的页面。无需管理员访问权限。',
  },
}

export const extensionDallE = {
  type: PluginType.extension,
  org: 'OpenAI',
  name: 'DALL-E',
  latest_version: '1.0.0',
  icon: 'https://via.placeholder.com/150',
  label: {
    'en-US': 'DALL-E',
    'zh-Hans': 'DALL-E',
  },
  brief: {
    'en-US': 'Description: A simple plugin to use OpenAI DALL-E model.',
    'zh-Hans': '一个使用 OpenAI DALL-E 模型的简单插件。',
  },
}

export const modelGPT4 = {
  type: PluginType.model,
  org: 'OpenAI',
  name: 'GPT-4',
  latest_version: '1.0.0',
  icon: 'https://via.placeholder.com/150',
  label: {
    'en-US': 'GPT-4',
    'zh-Hans': 'GPT-4',
  },
  brief: {
    'en-US': 'Description: A simple plugin to use OpenAI GPT-4 model.',
    'zh-Hans': '一个使用 OpenAI GPT-4 模型的简单插件。',
  },
}
