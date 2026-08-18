import type { DeploymentVersion } from '../version'

type VersionSelectionRequest = {
  currentVersionId?: string
  environment: string
  environmentId: string
  kind: 'changeVersion' | 'deploy'
}

type ConfigurationRequest = {
  currentVersionId?: string
  environment: string
  environmentId: string
  initialVersion: DeploymentVersion
  kind: 'deployLatest' | 'redeploy'
}

export type DeploymentDialogRequest = ConfigurationRequest | VersionSelectionRequest
