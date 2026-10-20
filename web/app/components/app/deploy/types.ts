import type { DropdownMenuActions } from '@langgenius/dify-ui/dropdown-menu'
import type { RefObject } from 'react'
import type { DeploymentVersion } from './utils/version'

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

export type DeploymentDialogPayload = {
  menuActionsRef?: RefObject<DropdownMenuActions | null>
  request: DeploymentDialogRequest
  returnFocusRef: RefObject<HTMLElement | null>
}
