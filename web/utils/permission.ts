import type { PermissionKey } from '@/models/access-control'
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

export const hasPermission = (permissionKeys: readonly PermissionKey[], permissionKeySet: PermissionKey | PermissionKey[]) => {
  if (Array.isArray(permissionKeySet)) {
    return permissionKeySet.some(key => permissionKeys.includes(key))
  }
  const singlePermissionKey = permissionKeySet
  return permissionKeys.includes(singlePermissionKey)
}
