export const getRedirection = (
  isCurrentWorkspaceEditor: boolean,
  app: any,
  redirectionFunc: (href: string) => void,
) => {
  if (!isCurrentWorkspaceEditor) {
    redirectionFunc(`/app/${app.app_id}/overview`)
  }
  else {
    if (app.mode === 'workflow' || app.mode === 'advanced-chat')
      redirectionFunc(`/app/${app.app_id}/workflow`)
    else
      redirectionFunc(`/app/${app.app_id}/configuration`)
  }
}
