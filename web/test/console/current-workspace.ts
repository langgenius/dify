import type { GetWorkspacesCurrentSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import { consoleQueryKey } from '@/test/console/operation-hooks'

const currentWorkspaceQueryKey = consoleQueryKey('workspaces.current.summary.get')

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
) => {
  const data = createCurrentWorkspaceFixture(workspace)
  queryClient.setQueryData(currentWorkspaceQueryKey, data)
  return data
}

export const ensureCurrentWorkspaceQuery = (
  queryClient: QueryClient,
  workspace: Partial<GetWorkspacesCurrentSummaryResponse> = {},
) => {
  const existingWorkspace =
    queryClient.getQueryData<GetWorkspacesCurrentSummaryResponse>(currentWorkspaceQueryKey)
  if (existingWorkspace === undefined) return seedCurrentWorkspaceQuery(queryClient, workspace)

  return existingWorkspace
}
