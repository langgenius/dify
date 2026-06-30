import { workspaces } from '@dify/contracts/api/console/workspaces/orpc.gen'
import { type } from '@orpc/contract'
import { base } from '../base'

type WorkspaceListItem = {
  id: string
  name: string
  plan: string
  status: string
  created_at: number
  current: boolean
}

export type GetWorkspacesResponse = {
  workspaces: WorkspaceListItem[]
}

export type SwitchWorkspaceRequest = {
  tenant_id: string
}

type SwitchedWorkspace = {
  id: string
  name: string | null
  plan: string | null
  status: string | null
  created_at: number | null
  role: string | null
  in_trial: boolean | null
  trial_end_reason: string | null
  custom_config: Record<string, unknown> | null
  trial_credits: number | null
  trial_credits_used: number | null
  next_credit_reset_date: number | null
}

export type SwitchWorkspaceResponse = {
  result: 'success' | 'fail'
  new_tenant: SwitchedWorkspace
}

export const workspacesGetContract = base
  .route({
    path: '/workspaces',
    method: 'GET',
  })
  .output(type<GetWorkspacesResponse>())

export const workspaceSwitchContract = base
  .route({
    path: '/workspaces/switch',
    method: 'POST',
  })
  .input(type<{
    body: SwitchWorkspaceRequest
  }>())
  .output(type<SwitchWorkspaceResponse>())

export const workspacesRouterContract = {
  ...workspaces,
  get: workspacesGetContract,
  switch: {
    post: workspaceSwitchContract,
  },
}
