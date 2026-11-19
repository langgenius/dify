import type { NetworkAccessGroupResponse } from '@dify/contracts/api/console/workspaces/types.gen'

export type CreatePolicySource = 'list_add_button' | 'list_empty_state'

export type PolicyDialogPayload = {
  mode: 'edit' | 'view'
  group: NetworkAccessGroupResponse
  opener?: HTMLElement
}
