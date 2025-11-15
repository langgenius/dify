import { AppModeEnum } from '@/types/app'

export const getRedirectionPath = (
  isCurrentWorkspaceEditor: boolean,
  app: { id: string, mode: AppModeEnum },
) => {
  if (!isCurrentWorkspaceEditor) {
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
  isCurrentWorkspaceEditor: boolean,
  app: { id: string, mode: AppModeEnum },
  redirectionFunc: (href: string) => void,
) => {
  const redirectionPath = getRedirectionPath(isCurrentWorkspaceEditor, app)
  redirectionFunc(redirectionPath)
}
