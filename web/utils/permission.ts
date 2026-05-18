import type { PermissionKey } from '@/models/access-control'
import { DatasetPermission } from '@/models/datasets'

export const AppACLPermission = {
  ViewLayout: 'app.acl.view_layout',
  TestAndRun: 'app.acl.test_and_run',
  Edit: 'app.acl.edit',
  ImportExportDSL: 'app.acl.import_export_dsl',
  Delete: 'app.acl.delete',
  ReleaseAndVersion: 'app.acl.release_and_version',
  Monitor: 'app.acl.monitor',
  AccessConfig: 'app.acl.access_config',
} as const

export const DatasetACLPermission = {
  Readonly: 'dataset.acl.readonly',
  Edit: 'dataset.acl.edit',
  ImportExportDSL: 'dataset.acl.import_export_dsl',
  PipelineTest: 'dataset.acl.pipeline_test',
  DocumentDownload: 'dataset.acl.document_download',
  RetrievalRecall: 'dataset.acl.retrieval_recall',
  Use: 'dataset.acl.use',
  DeleteFile: 'dataset.acl.delete_file',
  PipelineRelease: 'dataset.acl.pipeline_release',
  Delete: 'dataset.acl.delete',
  AccessConfig: 'dataset.acl.access_config',
} as const

type AppACLPermissionKey = typeof AppACLPermission[keyof typeof AppACLPermission]
type DatasetACLPermissionKey = typeof DatasetACLPermission[keyof typeof DatasetACLPermission]

type AppACLCapabilities = {
  canViewLayout: boolean
  canTestAndRun: boolean
  canEdit: boolean
  canImportExportDSL: boolean
  canDelete: boolean
  canReleaseAndVersion: boolean
  canMonitor: boolean
  canAccessConfig: boolean
}

type DatasetACLCapabilities = {
  canReadonly: boolean
  canEdit: boolean
  canImportExportDSL: boolean
  canPipelineTest: boolean
  canDocumentDownload: boolean
  canRetrievalRecall: boolean
  canUse: boolean
  canDeleteFile: boolean
  canPipelineRelease: boolean
  canDelete: boolean
  canAccessConfig: boolean
}

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

export const hasPermission = (permissionKeys: readonly PermissionKey[] | null | undefined, permissionKeySet: PermissionKey | PermissionKey[]) => {
  if (!permissionKeys)
    return false

  if (Array.isArray(permissionKeySet)) {
    return permissionKeySet.some(key => permissionKeys.includes(key))
  }
  const singlePermissionKey = permissionKeySet
  return permissionKeys.includes(singlePermissionKey)
}

export const getAppACLCapabilities = (permissionKeys: readonly PermissionKey[] | null | undefined): AppACLCapabilities => ({
  canViewLayout: hasPermission(permissionKeys, AppACLPermission.ViewLayout),
  canTestAndRun: hasPermission(permissionKeys, AppACLPermission.TestAndRun),
  canEdit: hasPermission(permissionKeys, AppACLPermission.Edit),
  canImportExportDSL: hasPermission(permissionKeys, AppACLPermission.ImportExportDSL),
  canDelete: hasPermission(permissionKeys, AppACLPermission.Delete),
  canReleaseAndVersion: hasPermission(permissionKeys, AppACLPermission.ReleaseAndVersion),
  canMonitor: hasPermission(permissionKeys, AppACLPermission.Monitor),
  canAccessConfig: hasPermission(permissionKeys, AppACLPermission.AccessConfig),
})

export const getDatasetACLCapabilities = (permissionKeys: readonly PermissionKey[] | null | undefined): DatasetACLCapabilities => ({
  canReadonly: hasPermission(permissionKeys, DatasetACLPermission.Readonly),
  canEdit: hasPermission(permissionKeys, DatasetACLPermission.Edit),
  canImportExportDSL: hasPermission(permissionKeys, DatasetACLPermission.ImportExportDSL),
  canPipelineTest: hasPermission(permissionKeys, DatasetACLPermission.PipelineTest),
  canDocumentDownload: hasPermission(permissionKeys, DatasetACLPermission.DocumentDownload),
  canRetrievalRecall: hasPermission(permissionKeys, DatasetACLPermission.RetrievalRecall),
  canUse: hasPermission(permissionKeys, DatasetACLPermission.Use),
  canDeleteFile: hasPermission(permissionKeys, DatasetACLPermission.DeleteFile),
  canPipelineRelease: hasPermission(permissionKeys, DatasetACLPermission.PipelineRelease),
  canDelete: hasPermission(permissionKeys, DatasetACLPermission.Delete),
  canAccessConfig: hasPermission(permissionKeys, DatasetACLPermission.AccessConfig),
})

export const hasAppACLPermission = (
  permissionKeys: readonly PermissionKey[] | null | undefined,
  permissionKeySet: AppACLPermissionKey | AppACLPermissionKey[],
) => hasPermission(permissionKeys, permissionKeySet)

export const hasDatasetACLPermission = (
  permissionKeys: readonly PermissionKey[] | null | undefined,
  permissionKeySet: DatasetACLPermissionKey | DatasetACLPermissionKey[],
) => hasPermission(permissionKeys, permissionKeySet)
