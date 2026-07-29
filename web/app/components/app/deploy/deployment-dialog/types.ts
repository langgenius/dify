export type DeploymentDialogRequest = {
  currentVersion?: string
  environment: string
  kind: 'changeVersion' | 'deploy'
}
