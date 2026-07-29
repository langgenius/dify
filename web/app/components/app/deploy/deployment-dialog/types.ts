import type { MockVersion } from '../mock-data'

type VersionSelectionRequest = {
  currentVersion?: string
  environment: string
  kind: 'changeVersion' | 'deploy'
}

type ConfigurationRequest = {
  currentVersion?: string
  environment: string
  initialVersion: MockVersion
  kind: 'deployLatest' | 'redeploy'
}

export type DeploymentDialogRequest = ConfigurationRequest | VersionSelectionRequest
