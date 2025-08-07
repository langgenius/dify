import type { AppMode } from '@/types/app'

export const getRedirectionPath = (
  isCurrentWorkspaceEditor: boolean,
  app: { id: string, mode: AppMode },
) => {
  if (!isCurrentWorkspaceEditor) {
    return `/app/${app.id}/overview`
  }
  else {
    if (app.mode === 'workflow' || app.mode === 'advanced-chat')
      return `/app/${app.id}/workflow`
    else
      return `/app/${app.id}/configuration`
  }
}

export const getRedirection = (
  isCurrentWorkspaceEditor: boolean,
  app: { id: string, mode: AppMode },
  redirectionFunc: (href: string) => void,
) => {
  const redirectionPath = getRedirectionPath(isCurrentWorkspaceEditor, app)
  redirectionFunc(redirectionPath)
}
