import type { GetWorkspacesCurrentSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { QueryClient, QueryKey } from '@tanstack/react-query'

export const currentWorkspaceQueryKey = [
  ['console', 'workspaces', 'current', 'summary', 'get'],
  { type: 'query' },
] as const

const createCurrentWorkspaceFixture = (
  overrides: Partial<GetWorkspacesCurrentSummaryResponse> = {},
): GetWorkspacesCurrentSummaryResponse => ({
  id: 'workspace-1',
  name: 'Workspace',
  plan: null,
  role: 'owner',
  credits: null,
  ...overrides,
})

export const seedCurrentWorkspaceQuery = (
  queryClient: QueryClient,
  workspace: Partial<GetWorkspacesCurrentSummaryResponse> = {},
  queryKey: QueryKey = currentWorkspaceQueryKey,
) => {
  const data = createCurrentWorkspaceFixture(workspace)
  queryClient.setQueryData(queryKey, data)
  return data
}

export const ensureCurrentWorkspaceQuery = (
  queryClient: QueryClient,
  workspace: Partial<GetWorkspacesCurrentSummaryResponse> = {},
  queryKey: QueryKey = currentWorkspaceQueryKey,
) => {
  const existingWorkspace = queryClient.getQueryData<GetWorkspacesCurrentSummaryResponse>(queryKey)
  if (existingWorkspace === undefined)
    return seedCurrentWorkspaceQuery(queryClient, workspace, queryKey)

  return existingWorkspace
}
