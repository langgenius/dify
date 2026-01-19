import type { ICurrentWorkspace } from '@/models/common'
import { useQuery } from '@tanstack/react-query'
import { get } from './base'

type WorkspacePermissions = {
  workspace_id: ICurrentWorkspace['id']
  allow_member_invite: boolean
  allow_owner_transfer: boolean
}

export function useWorkspacePermissions(workspaceId: ICurrentWorkspace['id'], enabled: boolean) {
  return useQuery({
    queryKey: ['workspace-permissions', workspaceId],
    queryFn: () => get<WorkspacePermissions>('/workspaces/current/permission'),
    enabled: enabled && !!workspaceId,
  })
}
