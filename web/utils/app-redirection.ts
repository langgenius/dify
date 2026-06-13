import { AppModeEnum } from '@/types/app'

export const getRedirectionPath = (
  isCurrentWorkspaceEditor: boolean,
  app: { id: string, mode: AppModeEnum },
  isCurrentWorkspaceViewer = false,
) => {
  const isWorkflowStyle = app.mode === AppModeEnum.WORKFLOW || app.mode === AppModeEnum.ADVANCED_CHAT
  if (!isCurrentWorkspaceEditor) {
    // The read-only `viewer` role may open the workflow canvas (read-only) for
    // workflow-style apps; other apps still land on the overview page.
    if (isCurrentWorkspaceViewer && isWorkflowStyle)
      return `/app/${app.id}/workflow`
    return `/app/${app.id}/overview`
  }
  else {
    if (isWorkflowStyle)
      return `/app/${app.id}/workflow`
    else
      return `/app/${app.id}/configuration`
  }
}

export const getRedirection = (
  isCurrentWorkspaceEditor: boolean,
  app: { id: string, mode: AppModeEnum },
  redirectionFunc: (href: string) => void,
  isCurrentWorkspaceViewer = false,
) => {
  const redirectionPath = getRedirectionPath(isCurrentWorkspaceEditor, app, isCurrentWorkspaceViewer)
  redirectionFunc(redirectionPath)
}
