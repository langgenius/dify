import type { ExternalAgentListItem } from './components/external-agent-list'

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
        'Reviews contract clauses against your company’s policies, identifies risks, and suggests safer wording.',
      enabled: true,
      connectedByMe: true,
      createdAt: now - 3600000,
      updatedAt: now - 180000,
      apps,
    },
  ]
}
