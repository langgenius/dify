import type { GetWorkspacesCurrentPermissionResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { useQuery } from '@tanstack/react-query'
import { get } from './base'

export function useWorkspacePermissions(
  workspaceId: GetWorkspacesCurrentPermissionResponse['workspace_id'],
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['workspace-permissions', workspaceId],
    queryFn: () => get<GetWorkspacesCurrentPermissionResponse>('/workspaces/current/permission'),
    enabled: enabled && !!workspaceId,
  })
}
