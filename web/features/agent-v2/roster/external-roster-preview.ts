import type { ExternalAgentListItem } from './components/external-agent-list'

export type ExternalConnectionPreview = Pick<
  ExternalAgentListItem,
  'name' | 'description' | 'icon'
> & {
  protocol: string
  skills: readonly string[]
}

// Agent Card example for the local connection flow, until verification is available.
export const externalConnectionPreview: ExternalConnectionPreview = {
  name: 'Contract Review Agent',
  description:
    'Reviews contract clauses against your company’s policies, identifies risks, and suggests safer wording.',
  protocol: 'A2A 1.0',
  skills: ['Contract review', 'Clause rewrite'],
}

// Temporary design data for the UI phase. This is not an API response or persisted workspace data.
export function createExternalRosterPreview(now = Date.now()): ExternalAgentListItem[] {
  const apps = [
    { name: 'Procurement Contract Review', kind: 'workflow' as const },
    { name: 'Contract Review Assistant', kind: 'chatflow' as const },
    { name: 'Contract Renewal Review', kind: 'workflow' as const },
  ]
  return [
    {
      key: 'vendor-screening',
      name: 'Vendor Screening Agent',
      role: 'Procurement',
      description: 'Screens new vendors against your sanctions and risk lists.',
      enabled: false,
      connectedByMe: false,
      createdAt: now - 86400000,
      updatedAt: now - 180000,
      apps,
    },
    {
      key: 'contract-review',
      name: 'Contract Review Agent',
      role: 'Legal & compliance',
      description:
        'Reviews contract clauses against your company’s policies, identifies risks, and suggests safer wording. Maintained by the legal team in their own environment.',
      enabled: true,
      connectedByMe: true,
      createdAt: now - 3600000,
      updatedAt: now - 180000,
      apps,
    },
  ]
}
