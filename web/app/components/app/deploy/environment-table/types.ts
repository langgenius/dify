import type { EnvironmentDeployment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { DropdownMenuActions } from '@langgenius/dify-ui/dropdown-menu'
import type { RefObject } from 'react'

export type UndeployHandler = (deployment: EnvironmentDeployment) => Promise<void> | void

export type UndeployDialogPayload = {
  deployment: EnvironmentDeployment
  menuActionsRef: RefObject<DropdownMenuActions | null>
  returnFocusRef: RefObject<HTMLElement | null>
}
