import { RiToolsLine } from '@remixicon/react'
import type { ActionItem } from './types'
import type { Collection } from '@/app/components/tools/types'

// Mock data for tools
const mockTools: Collection[] = [
  {
    name: 'google_search',
    label: 'Google Search',
    description: 'Search the web using Google Search API',
    icon: 'https://www.google.com/favicon.ico',
    type: 'builtin',
    author: 'Dify',
  },
  {
    name: 'wikipedia',
    label: 'Wikipedia Code',
    description: 'Search and retrieve information from Wikipedia',
    icon: 'https://wikipedia.org/favicon.ico',
    type: 'builtin',
    author: 'Dify',
  },
  {
    name: 'slack',
    label: 'Slack',
    description: 'Send messages and interact with Slack workspace',
    icon: 'https://slack.com/favicon.ico',
    type: 'api',
    author: 'Slack',
  },
  {
    name: 'github',
    label: 'GitHub',
    description: 'Interact with GitHub repositories and issues',
    icon: 'https://github.com/favicon.ico',
    type: 'api',
    author: 'GitHub',
  },
  {
    name: 'calculator',
    label: 'Calculator',
    description: 'Perform mathematical calculations',
    icon: '🧮',
    type: 'builtin',
    author: 'Dify',
  },
  {
    name: 'weather',
    label: 'Weather API',
    description: 'Get current weather information for any location',
    icon: '🌤️',
    type: 'api',
    author: 'WeatherAPI',
  },
  {
    name: 'email',
    label: 'Email Sender',
    description: 'Send emails through SMTP',
    icon: '📧',
    type: 'builtin',
    author: 'Dify',
  },
] as unknown as Collection[]

const parser = (tools: Collection[]) => {
  return tools.map(tool => ({
    id: tool.name,
    title: tool.label || tool.name,
    description: tool.description.en_US,
    type: 'tool' as const,
    path: `/tools?provider=${tool.name}`,
    icon: <RiToolsLine className="h-4 w-4 text-text-secondary" />,
  }))
}

export const toolsAction: ActionItem = {
  key: '@tools',
  shortcut: '@tools',
  title: 'Search Tools',
  description: 'Search and navigate to your tools',
  search: (_, searchTerm = '') => {
    if (!searchTerm.trim()) return parser(mockTools)

    const filteredTools = mockTools.filter(tool =>
      tool.name.toLowerCase().includes(searchTerm.toLowerCase()),
    )

    return parser(filteredTools)
  },
}
