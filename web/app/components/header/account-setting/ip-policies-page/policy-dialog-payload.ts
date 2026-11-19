import type { NetworkAccessGroupResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { RefObject } from 'react'

export type PolicyDialogPayload = {
  mode: 'edit' | 'view'
  group: NetworkAccessGroupResponse
  opener: RefObject<HTMLElement | null>
}

export type DeletePolicyPayload = {
  group: NetworkAccessGroupResponse
  opener: HTMLElement
}
