export type SkeletonRow = {
  accessPointCount: number
  activity: string
  actor: string
  environment: string
  environmentWidth?: number
  id: string
  status: string
  version?: string
  versionBadge?: string
}

export const ACCESS_POINT_ICONS = [
  'i-ri-robot-2-line',
  'i-custom-vender-knowledge-api-aggregate',
  'i-custom-vender-integrations-mcp',
  'i-custom-vender-integrations-trigger',
]

export const SKELETON_ROWS: SkeletonRow[] = [
  {
    accessPointCount: 3,
    activity: 'Deploy Sprint-42 succeeded',
    actor: 'by Evan · 3d ago',
    environment: 'Canary',
    id: 'canary-primary',
    status: 'Disabled',
    version: 'Sprint-42',
    versionBadge: 'LATEST',
  },
  {
    accessPointCount: 2,
    activity: 'Deploy #11 succeeded',
    actor: 'by Evan · 3d ago',
    environment: 'Pre-release',
    id: 'pre-release-primary',
    status: 'Disabled',
    version: 'Version-02',
    versionBadge: '1',
  },
  {
    accessPointCount: 2,
    activity: 'Deploy #11 succeeded',
    actor: 'by Rhonda · 3d ago',
    environment: 'Prod',
    id: 'prod',
    status: 'Disabled',
    version: 'v0.9-hotfix',
    versionBadge: '1',
  },
  {
    accessPointCount: 1,
    activity: 'Deploy #10 failed',
    actor: 'by Rhonda · 3d ago',
    environment: 'EU-Prod',
    id: 'eu-prod',
    status: 'Disabled',
    version: 'v0.6-beta',
    versionBadge: '2',
  },
  {
    accessPointCount: 3,
    activity: 'Deploy Sprint-42 succeeded',
    actor: 'by Evan · 3d ago',
    environment: 'Canary',
    id: 'canary-secondary',
    status: 'Disabled',
    version: 'Sprint-42',
    versionBadge: 'LATEST',
  },
  {
    accessPointCount: 1,
    activity: 'Deploy #11 succeeded',
    actor: 'by Rhonda · 3d ago',
    environment: 'QA',
    environmentWidth: 118,
    id: 'qa',
    status: 'Disabled',
    version: 'v0.3-beta',
    versionBadge: '1',
  },
  {
    accessPointCount: 1,
    activity: 'Deploy #11 succeeded',
    actor: 'by Rhonda · 3d ago',
    environment: 'Sandbox',
    id: 'sandbox',
    status: 'Disabled',
    version: 'v0.3-beta',
    versionBadge: '1',
  },
  {
    accessPointCount: 1,
    activity: 'Deploy #10 failed',
    actor: 'by Rhonda · 3d ago',
    environment: 'Preview',
    id: 'preview',
    status: 'Disabled',
  },
  {
    accessPointCount: 2,
    activity: 'Deploy #11 succeeded',
    actor: 'by Evan · 3d ago',
    environment: 'Pre-release',
    id: 'pre-release-secondary',
    status: 'Disabled',
    version: 'Version-02',
    versionBadge: '1',
  },
]

export const SKELETON_HEADER_LABELS = [
  'Environment',
  'Live version',
  'Status',
  'Last activity',
  'Access points',
  'Actions',
]
