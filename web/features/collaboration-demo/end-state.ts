export type DemoEndState =
  | { kind: 'loading' }
  | { kind: 'enabled' }
  | { kind: 'upgrade' }
  | { kind: 'upgradeContactAdmin' }
  | { kind: 'unavailable' }

type DemoEndInput = {
  features:
    | { status: 'pending' }
    | { status: 'error' }
    | { status: 'success'; collaborationEnabled: boolean; upgradeAvailable: boolean }
  canManageBilling: boolean
}

export function getDemoEndState({ features, canManageBilling }: DemoEndInput): DemoEndState {
  if (features.status === 'pending') return { kind: 'loading' }
  if (features.status === 'error') return { kind: 'unavailable' }

  if (features.collaborationEnabled) return { kind: 'enabled' }
  if (features.upgradeAvailable)
    return canManageBilling ? { kind: 'upgrade' } : { kind: 'upgradeContactAdmin' }

  return { kind: 'unavailable' }
}
