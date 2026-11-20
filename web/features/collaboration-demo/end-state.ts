import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'

type DemoApp = Pick<AppPartial, 'id' | 'name' | 'updated_at'>

export type DemoEndState =
  | { kind: 'loading' }
  | { kind: 'appsLoading' }
  | { kind: 'tryNow'; app: DemoApp }
  | { kind: 'appsError' }
  | { kind: 'createApp' }
  | { kind: 'readOnly'; role: 'normal' | 'datasetOperator' }
  | { kind: 'upgrade' }
  | { kind: 'upgradeContactAdmin' }
  | { kind: 'unavailable' }

type DemoEndInput = {
  features:
    | { status: 'pending' }
    | { status: 'error' }
    | { status: 'success'; collaborationEnabled: boolean; upgradeAvailable: boolean }
  role: string | undefined
  apps: { status: 'pending' } | { status: 'error' } | { status: 'success'; latest?: DemoApp }
}

export const canEditApps = (role: string | undefined) =>
  role === 'owner' || role === 'admin' || role === 'editor'

export function pickLatestApp(...apps: (DemoApp | undefined)[]) {
  return apps.reduce<DemoApp | undefined>(
    (latest, app) =>
      app && (!latest || (app.updated_at ?? 0) > (latest.updated_at ?? 0)) ? app : latest,
    undefined,
  )
}

export function getDemoEndState({ features, role, apps }: DemoEndInput): DemoEndState {
  if (features.status === 'pending') return { kind: 'loading' }
  if (features.status === 'error') return { kind: 'unavailable' }

  if (features.collaborationEnabled) {
    if (!canEditApps(role))
      return { kind: 'readOnly', role: role === 'dataset_operator' ? 'datasetOperator' : 'normal' }
    if (apps.status === 'pending') return { kind: 'appsLoading' }
    if (apps.status === 'error') return { kind: 'appsError' }
    return apps.latest ? { kind: 'tryNow', app: apps.latest } : { kind: 'createApp' }
  }

  if (features.upgradeAvailable)
    return role === 'owner' || role === 'admin'
      ? { kind: 'upgrade' }
      : { kind: 'upgradeContactAdmin' }

  return { kind: 'unavailable' }
}
