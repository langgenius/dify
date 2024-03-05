export const getRedirection = (
  isCurrentWorkspaceManager: boolean,
  app: any,
  redirectionFunc: (href: string) => void,
) => {
  if (!isCurrentWorkspaceManager) {
    redirectionFunc(`/app/${app.id}/overview`)
  }
  else {
    if (app.mode === 'workflow' || app.mode === 'advanced-chat')
      redirectionFunc(`/app/${app.id}/workflow`)
    else
      redirectionFunc(`/app/${app.id}/configuration`)
  }
}
