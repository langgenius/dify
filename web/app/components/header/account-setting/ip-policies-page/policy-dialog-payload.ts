import type { NetworkAccessGroupResponse } from '@dify/contracts/api/console/workspaces/types.gen'

export type PolicyDialogPayload = {
  mode: 'edit' | 'view'
  group: NetworkAccessGroupResponse
  opener?: HTMLElement
}

export type DeletePolicyPayload = {
  group: NetworkAccessGroupResponse
  opener: HTMLElement
}
