import type { EnvironmentDeployment } from '@dify/contracts/enterprise-app-deploy/types.gen'

export type UndeployHandler = (deployment: EnvironmentDeployment) => Promise<void> | void

export type OpenUndeployDialog = (
  deployment: EnvironmentDeployment,
  returnFocusElement: HTMLElement | null,
) => void
