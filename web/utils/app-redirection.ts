import type { ResourceMaintainerPermissionOptions } from '@/utils/permission'
import { AppModeEnum } from '@/types/app'
import { getAppACLCapabilities } from '@/utils/permission'

type AppRedirectionTarget = {
  id: string
  mode: AppModeEnum
  permission_keys?: string[]
}

export const getRedirectionPath = (
  app: AppRedirectionTarget,
  maintainerPermissionOptions?: ResourceMaintainerPermissionOptions,
) => {
  const appACLCapabilities = getAppACLCapabilities(app.permission_keys, maintainerPermissionOptions)

  if (appACLCapabilities.canAccessLayout) {
    if (app.mode === AppModeEnum.WORKFLOW || app.mode === AppModeEnum.ADVANCED_CHAT)
      return `/app/${app.id}/workflow`
    else
      return `/app/${app.id}/configuration`
  }

  if (appACLCapabilities.canMonitor)
    return `/app/${app.id}/overview`

  if (appACLCapabilities.canAccessLogAndAnnotation)
    return `/app/${app.id}/logs`

  if (appACLCapabilities.canAccessConfig)
    return `/app/${app.id}/access-config`

  return `/app/${app.id}/develop`
}

export const getRedirection = (
  app: AppRedirectionTarget,
  redirectionFunc: (href: string) => void,
  maintainerPermissionOptions?: ResourceMaintainerPermissionOptions,
) => {
  const redirectionPath = getRedirectionPath(app, maintainerPermissionOptions)
  redirectionFunc(redirectionPath)
}
