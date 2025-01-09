import type { PluginDeclaration } from '../types'
import { PluginType } from '../types'

export const toolNeko: PluginDeclaration = {
  plugin_unique_identifier: 'xxxxxx',
  version: '0.0.1',
  author: 'langgenius',
  name: 'neko',
  description: {
    en_US: 'Neko is a cute cat.',
    zh_Hans: '这是一只可爱的小猫。',
    pt_BR: 'Neko is a cute cat.',
    ja_JP: 'Neko is a cute cat.',
  },
  icon: '241e5209ecc8b5ce6b7a29a8e50388e9c75b89c3047c6ecd8e552f26de758883.svg',
  label: {
    en_US: 'Neko',
    zh_Hans: 'Neko',
    pt_BR: 'Neko',
    ja_JP: 'Neko',
  },
  category: 'extension' as any,
  created_at: '2024-07-12T08:03:44.658609Z',
  resource: {
    memory: 1048576,
    permission: {
      tool: {
        enabled: true,
      },
      model: {
        enabled: true,
        llm: true,
        text_embedding: false,
        rerank: false,
        tts: false,
        speech2text: false,
        moderation: false,
      },
      node: null,
      endpoint: {
        enabled: true,
      },
      storage: {
        enabled: true,
        size: 1048576,
      },
    },
  },
  plugins: {
    tools: null,
    models: null,
    endpoints: [
      'provider/neko.yaml',
    ],
  },
  tags: [],
  verified: false,
  tool: null,
  model: null,
  endpoint: null,
}

export const toolNotion = {
  type: PluginType.tool,
  org: 'Notion',
  name: 'notion page search',
  version: '1.2.0',
  latest_version: '1.3.0',
  icon: 'https://via.placeholder.com/150',
  label: {
    'en-US': 'Notion Page Search',
    'zh-Hans': 'Notion 页面搜索',
  },
  brief: {
    'en-US': 'Description: Search Notion pages and open visited ones faster. No admin access required.More and more info...More and more info...More and more info...',
    'zh-Hans': '搜索 Notion 页面并更快地打开已访问的页面。无需管理员访问权限。More and more info...More and more info...More and more info...',
  },
}

export const toolNotionManifest: PluginDeclaration = {
  version: '1.2.0',
  author: 'Notion',
  icon: 'https://via.placeholder.com/150',
  name: 'notion page search',
  category: PluginType.tool,
  label: {
    'en-US': 'Notion Page Search',
    'zh-Hans': 'Notion 页面搜索',
  },
  description: {
    'en-US': 'Description: Search Notion pages and open visited ones faster. No admin access required.More and more info...More and more info...More and more info...',
    'zh-Hans': '搜索 Notion 页面并更快地打开已访问的页面。无需管理员访问权限。More and more info...More and more info...More and more info...',
  },
  created_at: '2022-01-01',
  resource: {},
  plugins: {},
  verified: true,
  endpoint: {
    settings: [],
    endpoints: [],
  },
  tool: {
  } as any,
  model: {},
}

export const extensionDallE = {
  type: PluginType.extension,
  org: 'OpenAI',
  name: 'DALL-E',
  version: '1.1.0',
  latest_version: '1.2.0',
  install_count: 1234,
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
  version: '1.0.0',
  latest_version: '1.0.0',
  install_count: 99999,
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

export const customTool = {
  type: PluginType.tool,
  name: 'notion page search',
  version: '1.2.0',
  latest_version: '1.3.0',
  icon: {
    content: '🕵️',
    background: '#FEF7C3',
  },
  label: {
    'en-US': 'Notion Page Search',
    'zh-Hans': 'Notion 页面搜索',
  },
  brief: {
    'en-US': 'Description: Search Notion pages and open visited ones faster. No admin access required.More and more info...More and more info...More and more info...',
    'zh-Hans': '搜索 Notion 页面并更快地打开已访问的页面。无需管理员访问权限。More and more info...More and more info...More and more info...',
  },
}
