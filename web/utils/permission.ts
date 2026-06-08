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

export type CreatorPermissionOptions = {
  currentUserId?: string | null
  resourceCreatedBy?: string | null
  workspacePermissionKeys?: readonly PermissionKey[] | null
}

type AppACLCapabilities = {
  canViewLayout: boolean
  canTestAndRun: boolean
  canEdit: boolean
  canAccessLayout: boolean
  canComment: boolean
  canPreviewApp: boolean
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

const shouldGrantCreatorPermissions = (
  options: CreatorPermissionOptions | undefined,
  createPermissionKey: PermissionKey,
) => {
  if (!options?.currentUserId || !options?.resourceCreatedBy)
    return false

  return options.currentUserId === options.resourceCreatedBy
    && hasPermission(options.workspacePermissionKeys, createPermissionKey)
}

const hasResourcePermission = (
  permissionKeys: readonly PermissionKey[] | null | undefined,
  permissionKey: PermissionKey,
  hasCreatorPermissions: boolean,
) => hasCreatorPermissions || hasPermission(permissionKeys, permissionKey)

export const getAppACLCapabilities = (
  permissionKeys: readonly PermissionKey[] | null | undefined,
  options?: CreatorPermissionOptions,
): AppACLCapabilities => {
  const hasCreatorPermissions = shouldGrantCreatorPermissions(options, 'app.create_and_management')
  const canViewLayout = hasResourcePermission(permissionKeys, AppACLPermission.ViewLayout, hasCreatorPermissions)
  const canTestAndRun = hasResourcePermission(permissionKeys, AppACLPermission.TestAndRun, hasCreatorPermissions)
  const canEdit = hasResourcePermission(permissionKeys, AppACLPermission.Edit, hasCreatorPermissions)

  return {
    canViewLayout,
    canTestAndRun,
    canEdit,
    canAccessLayout: canViewLayout || canTestAndRun || canEdit,
    canComment: canViewLayout || canTestAndRun || canEdit,
    canPreviewApp: canViewLayout || canTestAndRun,
    canImportExportDSL: hasResourcePermission(permissionKeys, AppACLPermission.ImportExportDSL, hasCreatorPermissions),
    canDelete: hasResourcePermission(permissionKeys, AppACLPermission.Delete, hasCreatorPermissions),
    canReleaseAndVersion: hasResourcePermission(permissionKeys, AppACLPermission.ReleaseAndVersion, hasCreatorPermissions),
    canMonitor: hasResourcePermission(permissionKeys, AppACLPermission.Monitor, hasCreatorPermissions),
    canAccessConfig: hasResourcePermission(permissionKeys, AppACLPermission.AccessConfig, hasCreatorPermissions),
  }
}

export const getDatasetACLCapabilities = (
  permissionKeys: readonly PermissionKey[] | null | undefined,
  options?: CreatorPermissionOptions,
): DatasetACLCapabilities => {
  const hasCreatorPermissions = shouldGrantCreatorPermissions(options, 'dataset.create_and_management')

  return {
    canReadonly: hasResourcePermission(permissionKeys, DatasetACLPermission.Readonly, hasCreatorPermissions),
    canEdit: hasResourcePermission(permissionKeys, DatasetACLPermission.Edit, hasCreatorPermissions),
    canImportExportDSL: hasResourcePermission(permissionKeys, DatasetACLPermission.ImportExportDSL, hasCreatorPermissions),
    canPipelineTest: hasResourcePermission(permissionKeys, DatasetACLPermission.PipelineTest, hasCreatorPermissions),
    canDocumentDownload: hasResourcePermission(permissionKeys, DatasetACLPermission.DocumentDownload, hasCreatorPermissions),
    canRetrievalRecall: hasResourcePermission(permissionKeys, DatasetACLPermission.RetrievalRecall, hasCreatorPermissions),
    canUse: hasResourcePermission(permissionKeys, DatasetACLPermission.Use, hasCreatorPermissions),
    canDeleteFile: hasResourcePermission(permissionKeys, DatasetACLPermission.DeleteFile, hasCreatorPermissions),
    canPipelineRelease: hasResourcePermission(permissionKeys, DatasetACLPermission.PipelineRelease, hasCreatorPermissions),
    canDelete: hasResourcePermission(permissionKeys, DatasetACLPermission.Delete, hasCreatorPermissions),
    canAccessConfig: hasResourcePermission(permissionKeys, DatasetACLPermission.AccessConfig, hasCreatorPermissions),
  }
}
