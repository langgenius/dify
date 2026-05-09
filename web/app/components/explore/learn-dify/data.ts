import type { AppIconType } from '@/types/app'

export type LearnDifyItem = {
  id: string
  title: string
  description: string
  icon_type: AppIconType | null
  icon: string
  icon_background: string | null
  icon_url: string | null
}

export const learnDifyItems: LearnDifyItem[] = [
  {
    id: 'first-workflow',
    title: 'Your first Workflow - say hello to AI',
    description: 'Search Notion pages and open visited ones faster. No admin access required.',
    icon_type: 'emoji',
    icon: '🤖',
    icon_background: '#F0FDF9',
    icon_url: null,
  },
  {
    id: 'agent-with-workflow',
    title: 'Build a working Agent with Workflow',
    description: 'Agent node to let your AI call tools and reason - inside a full Workflow you control.',
    icon_type: 'emoji',
    icon: '🤖',
    icon_background: '#F0FDF9',
    icon_url: null,
  },
  {
    id: 'if-else-logic',
    title: 'Add logic with If/Else',
    description: 'Route your workflow down different paths based on conditions.',
    icon_type: 'emoji',
    icon: '🤖',
    icon_background: '#F0FDF9',
    icon_url: null,
  },
  {
    id: 'customer-support-bot',
    title: 'Customer support bot',
    description: 'Auto-reply to common questions using your own knowledge base.',
    icon_type: 'emoji',
    icon: '🤖',
    icon_background: '#F0FDF9',
    icon_url: null,
  },
]
