import type { EndUserApp } from './model'
import { AppModeEnum } from '@/types/app'

// Design samples only. Replace the route's demo owner when the end-user API is available.
export const demoApps: readonly EndUserApp[] = [
  {
    id: 'sales-follow-up',
    name: 'Sales Follow-up Assistant',
    description: 'Research prospects and send personalized follow-up emails.',
    mode: AppModeEnum.WORKFLOW,
    icon: '🍯',
    iconBackground: 'var(--color-components-icon-bg-blue-soft)',
    starred: false,
    connectionStatus: 'not-configured',
    lastUsedAt: 4,
  },
  {
    id: 'lead-qualifier',
    name: 'Lead Qualifier',
    description: 'Assess leads and identify promising prospects.',
    mode: AppModeEnum.AGENT,
    icon: '🏖️',
    iconBackground: 'var(--color-components-icon-bg-violet-soft)',
    starred: false,
    connectionStatus: 'action-required',
    lastUsedAt: 3,
  },
  {
    id: 'research-inbox',
    name: 'Research Inbox',
    description: 'Find relevant emails and summarize research insights.',
    mode: AppModeEnum.WORKFLOW,
    icon: '🚀',
    iconBackground: 'var(--color-components-icon-bg-teal-soft)',
    starred: true,
    connectionStatus: 'ready',
    lastUsedAt: 2,
  },
  {
    id: 'customer-brief',
    name: 'Customer Brief',
    description: 'Summarize customer context before your next conversation.',
    mode: AppModeEnum.CHAT,
    icon: '🏖️',
    iconBackground: 'var(--color-components-icon-bg-violet-soft)',
    starred: true,
    connectionStatus: 'ready',
    lastUsedAt: 1,
  },
]
