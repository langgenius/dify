export type DemoEndState =
  | 'loading'
  | 'tryNow'
  | 'createApp'
  | 'noApps'
  | 'noAccess'
  | 'upgrade'
  | 'upgradeContactAdmin'
  | 'unavailable'

type DemoEndInput = {
  features:
    | { status: 'pending' }
    | { status: 'error' }
    | { status: 'success'; collaborationEnabled: boolean; upgradeAvailable: boolean }
  role: string | undefined
  hasCollaborativeApps: boolean | undefined
}

const canCreateApps = (role: string | undefined) =>
  role === 'owner' || role === 'admin' || role === 'editor'

export function getDemoEndState({
  features,
  role,
  hasCollaborativeApps,
}: DemoEndInput): DemoEndState {
  if (features.status === 'pending') return 'loading'
  if (features.status === 'error') return 'unavailable'

  if (features.collaborationEnabled) {
    if (role === 'dataset_operator') return 'noAccess'
    if (hasCollaborativeApps === undefined) return 'loading'
    if (hasCollaborativeApps) return 'tryNow'
    return canCreateApps(role) ? 'createApp' : 'noApps'
  }

  if (features.upgradeAvailable)
    return role === 'owner' || role === 'admin' ? 'upgrade' : 'upgradeContactAdmin'

  return 'unavailable'
}

export function getTryNowHref({ workflows, chatflows }: { workflows: number; chatflows: number }) {
  if (workflows > 0 && chatflows === 0) return '/apps?category=workflow'
  if (chatflows > 0 && workflows === 0) return '/apps?category=advanced-chat'
  return '/apps'
}
