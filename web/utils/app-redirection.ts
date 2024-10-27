export const getRedirection = (
  isCurrentWorkspaceEditor: boolean,
  app: any,
  redirectionFunc: (href: string) => void,
) => {
  if (!isCurrentWorkspaceEditor) {
    redirectionFunc(`/app/${app.id}/overview`)
  }
  else {
    if (app.mode === 'workflow' || app.mode === 'advanced-chat')
      redirectionFunc(`/app/${app.id}/workflow`)
    else
      redirectionFunc(`/app/${app.id}/configuration`)
  }
}
