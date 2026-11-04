import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'
import type { ResourceMaintainerPermissionOptions } from '@/utils/permission'
import { getAppACLCapabilities } from '@/utils/permission'

export type AppRedirectionTarget = {
  id: string
  mode: AppPartial['mode']
  permission_keys?: string[]
  bound_agent_id?: string | null
}

export const getRedirectionPath = (
  app: AppRedirectionTarget,
  maintainerPermissionOptions?: ResourceMaintainerPermissionOptions,
) => {
  if (app.mode === 'agent')
    return app.bound_agent_id ? `/agents/${app.bound_agent_id}/configure` : '/agents'

  const appACLCapabilities = getAppACLCapabilities(app.permission_keys, maintainerPermissionOptions)

  if (appACLCapabilities.canAccessLayout) {
    if (app.mode === 'workflow' || app.mode === 'advanced-chat') return `/app/${app.id}/workflow`
    else return `/app/${app.id}/configuration`
  }

  if (appACLCapabilities.canMonitor) return `/app/${app.id}/overview`

  if (appACLCapabilities.canAccessLogAndAnnotation) return `/app/${app.id}/logs`

  if (appACLCapabilities.canAccessConfig) return `/app/${app.id}/access-config`

  if (app.mode === 'workflow' && appACLCapabilities.canDeploy) return `/app/${app.id}/deploy`

  if (appACLCapabilities.canViewAccessPoint) return `/app/${app.id}/access-point`

  return '/apps'
}

export const getRedirection = (
  app: AppRedirectionTarget,
  redirectionFunc: (href: string) => void,
  maintainerPermissionOptions?: ResourceMaintainerPermissionOptions,
) => {
  const redirectionPath = getRedirectionPath(app, maintainerPermissionOptions)
  redirectionFunc(redirectionPath)
}
