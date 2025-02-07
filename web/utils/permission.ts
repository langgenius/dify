import { DatasetPermission } from '@/models/datasets'

type DatasetConfig = {
  createdBy: string
  partialMemberList: string[]
  permission: DatasetPermission
}

export const hasEditPermissionForDataset = (userId: string, datasetConfig: DatasetConfig) => {
  const { createdBy, partialMemberList, permission } = datasetConfig
  if (permission === DatasetPermission.onlyMe)
    return userId === createdBy
  if (permission === DatasetPermission.allTeamMembers)
    return true
  if (permission === DatasetPermission.partialMembers)
    return partialMemberList.includes(userId)
  return false
}
