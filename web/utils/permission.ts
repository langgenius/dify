import type { DatasetPermission } from '@/models/datasets'

type DatasetConfig = {
  createdBy: string
  partialMemberList: string[]
  permission: DatasetPermission
}

export const hasEditPermissionForDataset = (userId: string, datasetConfig: DatasetConfig) => {
  const { createdBy, partialMemberList, permission } = datasetConfig
  if (permission === 'only_me')
    return userId === createdBy
  if (permission === 'all_team_members')
    return true
  if (permission === 'partial_members')
    return partialMemberList.includes(userId)
  return false
}
