import type { ConnectionProvider, EndUserConnection, LinkedApp } from './model'

// Design samples only. Replace this owner when the end-user connections API is available.
export const demoProviders: readonly ConnectionProvider[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Read, search, and send emails.',
    iconClassName: 'i-custom-public-common-gmail',
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Search repositories and view repository information.',
    iconClassName: 'i-ri-github-fill',
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Access your Notion pages and databases.',
    iconClassName: 'i-custom-public-common-notion',
  },
  {
    id: 'youtube',
    name: 'YouTube',
    description: 'Search videos and view channel information.',
    iconClassName: 'i-ri-youtube-fill text-util-colors-red-red-600',
  },
]

const appHref = 'https://agent-app.dify.dev/workflow/RWv44MH1ypIb8gs8'
const salesApp: LinkedApp = {
  id: 'sales-follow-up',
  name: 'Sales Follow-up Assistant',
  description: 'Research prospects, review customer notes, and send personalized follow-up emails.',
  icon: '🍯',
  iconBackground: 'var(--color-components-icon-bg-blue-soft)',
  href: appHref,
}
const researchApp: LinkedApp = {
  id: 'research-inbox',
  name: 'Research Inbox',
  description: 'Find relevant emails and summarize research insights.',
  icon: '🚀',
  iconBackground: 'var(--color-components-icon-bg-teal-soft)',
  href: appHref,
}
const leadApp: LinkedApp = {
  id: 'lead-qualifier',
  name: 'Lead Qualifier',
  description: 'Assess leads and identify promising prospects.',
  icon: '🏖️',
  iconBackground: 'var(--color-components-icon-bg-violet-soft)',
  href: appHref,
}
const customerApp: LinkedApp = {
  id: 'customer-brief',
  name: 'Customer Brief',
  description: 'Summarize customer context before your next conversation.',
  icon: '🏖️',
  iconBackground: 'var(--color-components-icon-bg-violet-soft)',
  href: appHref,
}

export const demoConnections: Readonly<Record<string, readonly EndUserConnection[]>> = {
  gmail: [
    {
      id: 'gmail-alex',
      name: 'alex@northstar.io',
      type: 'oauth',
      apps: [salesApp, researchApp, leadApp],
    },
    { id: 'gmail-research', name: 'research@northstar.io', type: 'oauth', apps: [researchApp] },
    { id: 'gmail-archived', name: 'Archived key', type: 'api-key', apps: [salesApp] },
  ],
  github: [
    {
      id: 'github-alex',
      name: 'alex@northstar.io',
      type: 'oauth',
      apps: [researchApp, customerApp],
    },
    { id: 'github-key', name: 'Development key', type: 'api-key', apps: [researchApp] },
  ],
  notion: [{ id: 'notion-alex', name: 'alex@northstar.io', type: 'oauth', apps: [customerApp] }],
  youtube: [
    { id: 'youtube-research', name: 'research@northstar.io', type: 'oauth', apps: [researchApp] },
  ],
}
