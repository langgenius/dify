import type { PostWorkspacesCurrentResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { QueryClient, QueryKey } from '@tanstack/react-query'

export const currentWorkspaceQueryKey = [
  ['console', 'workspaces', 'current', 'post'],
  { type: 'query' },
] as const

export const createCurrentWorkspaceFixture = (
  overrides: Partial<PostWorkspacesCurrentResponse> = {},
): PostWorkspacesCurrentResponse => ({
  id: 'workspace-1',
  name: 'Workspace',
  plan: '',
  role: 'owner',
  status: '',
  created_at: 0,
  trial_credits: 0,
  trial_credits_used: 0,
  trial_credits_exhausted_at: 0,
  next_credit_reset_date: 0,
  ...overrides,
})

export const seedCurrentWorkspaceQuery = (
  queryClient: QueryClient,
  workspace: Partial<PostWorkspacesCurrentResponse> = {},
  queryKey: QueryKey = currentWorkspaceQueryKey,
) => {
  const data = createCurrentWorkspaceFixture(workspace)
  queryClient.setQueryData(queryKey, data)
  return data
}

export const ensureCurrentWorkspaceQuery = (
  queryClient: QueryClient,
  workspace: Partial<PostWorkspacesCurrentResponse> = {},
  queryKey: QueryKey = currentWorkspaceQueryKey,
) => {
  const existingWorkspace = queryClient.getQueryData<PostWorkspacesCurrentResponse>(queryKey)
  if (existingWorkspace === undefined)
    return seedCurrentWorkspaceQuery(queryClient, workspace, queryKey)

  return existingWorkspace
}
