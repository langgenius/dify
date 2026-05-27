import type { CreatorPermissionOptions } from '@/utils/permission'
import { AppModeEnum } from '@/types/app'
import { getAppACLCapabilities } from '@/utils/permission'

type AppRedirectionTarget = {
  id: string
  mode: AppModeEnum
  permission_keys?: string[]
}

export const getRedirectionPath = (
  app: AppRedirectionTarget,
  creatorPermissionOptions?: CreatorPermissionOptions,
) => {
  const appACLCapabilities = getAppACLCapabilities(app.permission_keys, creatorPermissionOptions)

  if (!appACLCapabilities.canAccessLayout) {
    return `/app/${app.id}/overview`
  }
  else {
    if (app.mode === AppModeEnum.WORKFLOW || app.mode === AppModeEnum.ADVANCED_CHAT)
      return `/app/${app.id}/workflow`
    else
      return `/app/${app.id}/configuration`
  }
}

export const getRedirection = (
  app: AppRedirectionTarget,
  redirectionFunc: (href: string) => void,
  creatorPermissionOptions?: CreatorPermissionOptions,
) => {
  const redirectionPath = getRedirectionPath(app, creatorPermissionOptions)
  redirectionFunc(redirectionPath)
}
