import { RiApps2Line } from '@remixicon/react'
import type { ActionItem } from './types'
import type { App } from '@/types/app'

// Mock data for applications
const mockApps: App[] = [
  {
    id: '1',
    name: 'Customer Support Bot',
    description: 'AI assistant for customer service inquiries',
    mode: 'chat',
    icon: '🤖',
    icon_background: '#3B82F6',
  },
  {
    id: '2',
    name: 'Code Review Assistant',
    description: 'Help review and improve code quality',
    mode: 'completion',
    icon: '💻',
    icon_background: '#10B981',
  },
  {
    id: '3',
    name: 'Content Generator',
    description: 'Generate marketing content and copy',
    mode: 'chat',
    icon: '✍️',
    icon_background: '#F59E0B',
  },
  {
    id: '4',
    name: 'Data Analyzer',
    description: 'Analyze and visualize business data',
    mode: 'workflow',
    icon: '📊',
    icon_background: '#8B5CF6',
  },
  {
    id: '5',
    name: 'Language Translator',
    description: 'Translate text between multiple languages',
    mode: 'completion',
    icon: '🌍',
    icon_background: '#EF4444',
  },
] as App[]

const parser = (apps: App[]) => {
  return apps.map(app => ({
    id: app.id,
    title: app.name,
    description: app.description,
    type: 'app' as const,
    path: `/app/${app.id}`,
    icon: <RiApps2Line className="h-4 w-4 text-text-secondary" />,
  }))
}

export const appAction: ActionItem = {
  key: '@app',
  shortcut: '@app',
  title: 'Search Applications',
  description: 'Search and navigate to your applications',
  // action,
  search: (query: string, searchTerm?: string) => {
    const term = searchTerm || query
    if (!term.trim()) return parser(mockApps)

    const filteredApps = mockApps.filter(app =>
      app.name.toLowerCase().includes(term.toLowerCase())
      || app.description?.toLowerCase().includes(term.toLowerCase()),
    )

    return parser(filteredApps)
  },
}
