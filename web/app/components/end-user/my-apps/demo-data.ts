import type { EndUserApp } from './model'

// Design samples only. Replace the route's demo owner when the end-user API is available.
export const demoApps: readonly EndUserApp[] = [
  {
    id: 'sales-follow-up',
    name: 'Sales Follow-up Assistant',
    description: 'Research prospects and send personalized follow-up emails.',
    mode: 'workflow',
    icon: {
      icon: '🍯',
      icon_type: 'emoji',
      icon_background: 'var(--color-components-icon-bg-blue-soft)',
    },
    starred: false,
    connectionStatus: 'not-configured',
    lastUsedAt: 4,
  },
  {
    id: 'lead-qualifier',
    name: 'Lead Qualifier',
    description: 'Assess leads and identify promising prospects.',
    mode: 'agent',
    icon: {
      icon: '🏖️',
      icon_type: 'emoji',
      icon_background: 'var(--color-components-icon-bg-violet-soft)',
    },
    starred: false,
    connectionStatus: 'action-required',
    lastUsedAt: 3,
  },
  {
    id: 'research-inbox',
    name: 'Research Inbox',
    description: 'Find relevant emails and summarize research insights.',
    mode: 'workflow',
    icon: {
      icon: '🚀',
      icon_type: 'emoji',
      icon_background: 'var(--color-components-icon-bg-teal-soft)',
    },
    starred: true,
    connectionStatus: 'ready',
    lastUsedAt: 2,
  },
  {
    id: 'customer-brief',
    name: 'Customer Brief',
    description: 'Summarize customer context before your next conversation.',
    mode: 'chat',
    icon: {
      icon: '🏖️',
      icon_type: 'emoji',
      icon_background: 'var(--color-components-icon-bg-violet-soft)',
    },
    starred: true,
    connectionStatus: 'ready',
    lastUsedAt: 1,
  },
]
