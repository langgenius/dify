import { AppModeEnum } from '@/types/app'
import { getAppACLCapabilities } from '@/utils/permission'

type AppRedirectionTarget = {
  id: string
  mode: AppModeEnum
  permission_keys?: string[]
}

export const getRedirectionPath = (
  app: AppRedirectionTarget,
) => {
  const appACLCapabilities = getAppACLCapabilities(app.permission_keys)

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
) => {
  const redirectionPath = getRedirectionPath(app)
  redirectionFunc(redirectionPath)
}
