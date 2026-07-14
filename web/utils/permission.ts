import type { PermissionKey } from '@/models/access-control'

export const AppACLPermission = {
  Preview: 'app.acl.preview',
  ViewLayout: 'app.acl.view_layout',
  TestAndRun: 'app.acl.test_and_run',
  Edit: 'app.acl.edit',
  ImportExportDSL: 'app.acl.import_export_dsl',
  Delete: 'app.acl.delete',
  ReleaseAndVersion: 'app.acl.release_and_version',
  Monitor: 'app.acl.monitor',
  TracingConfig: 'app.acl.tracing_config',
  LogAndAnnotation: 'app.acl.log_and_annotation',
  AccessConfig: 'app.acl.access_config',
} as const

export const DatasetACLPermission = {
  Preview: 'dataset.acl.preview',
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

export const BillingPermission = {
  View: 'billing.view',
  Manage: 'billing.manage',
  SubscriptionManage: 'billing.subscription.manage',
} as const

export type ResourceMaintainerPermissionOptions = {
  currentUserId?: string | null
  resourceMaintainer?: string | null
  workspacePermissionKeys?: readonly PermissionKey[] | null
  isRbacEnabled?: boolean
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
  canConfigureTracing: boolean
  canAccessLogAndAnnotation: boolean
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

export const hasPermission = (
  permissionKeys: readonly PermissionKey[] | null | undefined,
  permissionKeySet: PermissionKey | PermissionKey[],
) => {
  if (!permissionKeys) return false

  if (Array.isArray(permissionKeySet)) {
    return permissionKeySet.some((key) => permissionKeys.includes(key))
  }
  const singlePermissionKey = permissionKeySet
  return permissionKeys.includes(singlePermissionKey)
}

export const hasOnlyAppPreviewPermission = (
  permissionKeys: readonly PermissionKey[] | null | undefined,
) => {
  return permissionKeys?.length === 1 && permissionKeys[0] === AppACLPermission.Preview
}

export const hasOnlyDatasetPreviewPermission = (
  permissionKeys: readonly PermissionKey[] | null | undefined,
) => {
  return permissionKeys?.length === 1 && permissionKeys[0] === DatasetACLPermission.Preview
}

const shouldGrantMaintainerPermissions = (
  options: ResourceMaintainerPermissionOptions | undefined,
  createPermissionKey: PermissionKey,
) => {
  if (!options?.currentUserId || !options?.resourceMaintainer) return false

  return (
    options.currentUserId === options.resourceMaintainer &&
    hasPermission(options.workspacePermissionKeys, createPermissionKey)
  )
}

const hasResourcePermission = (
  permissionKeys: readonly PermissionKey[] | null | undefined,
  permissionKey: PermissionKey,
  hasMaintainerPermissions: boolean,
) => hasMaintainerPermissions || hasPermission(permissionKeys, permissionKey)

export const getAppACLCapabilities = (
  permissionKeys: readonly PermissionKey[] | null | undefined,
  options?: ResourceMaintainerPermissionOptions,
): AppACLCapabilities => {
  const hasMaintainerPermissions = shouldGrantMaintainerPermissions(
    options,
    'app.create_and_management',
  )
  const canViewLayout = hasResourcePermission(
    permissionKeys,
    AppACLPermission.ViewLayout,
    hasMaintainerPermissions,
  )
  const canTestAndRun = hasResourcePermission(
    permissionKeys,
    AppACLPermission.TestAndRun,
    hasMaintainerPermissions,
  )
  const canEdit = hasResourcePermission(
    permissionKeys,
    AppACLPermission.Edit,
    hasMaintainerPermissions,
  )

  return {
    canViewLayout,
    canTestAndRun,
    canEdit,
    canAccessLayout: canViewLayout || canTestAndRun || canEdit,
    canComment: canViewLayout || canEdit,
    canPreviewApp: canViewLayout || canTestAndRun,
    canImportExportDSL: hasResourcePermission(
      permissionKeys,
      AppACLPermission.ImportExportDSL,
      hasMaintainerPermissions,
    ),
    canDelete: hasResourcePermission(
      permissionKeys,
      AppACLPermission.Delete,
      hasMaintainerPermissions,
    ),
    canReleaseAndVersion: hasResourcePermission(
      permissionKeys,
      AppACLPermission.ReleaseAndVersion,
      hasMaintainerPermissions,
    ),
    canMonitor: hasResourcePermission(
      permissionKeys,
      AppACLPermission.Monitor,
      hasMaintainerPermissions,
    ),
    canConfigureTracing: hasResourcePermission(
      permissionKeys,
      AppACLPermission.TracingConfig,
      hasMaintainerPermissions,
    ),
    canAccessLogAndAnnotation: hasResourcePermission(
      permissionKeys,
      AppACLPermission.LogAndAnnotation,
      hasMaintainerPermissions,
    ),
    canAccessConfig:
      Boolean(options?.isRbacEnabled) &&
      hasResourcePermission(
        permissionKeys,
        AppACLPermission.AccessConfig,
        hasMaintainerPermissions,
      ),
  }
}

export const getDatasetACLCapabilities = (
  permissionKeys: readonly PermissionKey[] | null | undefined,
  options?: ResourceMaintainerPermissionOptions,
): DatasetACLCapabilities => {
  const hasMaintainerPermissions = shouldGrantMaintainerPermissions(
    options,
    'dataset.create_and_management',
  )

  return {
    canReadonly: hasResourcePermission(
      permissionKeys,
      DatasetACLPermission.Readonly,
      hasMaintainerPermissions,
    ),
    canEdit: hasResourcePermission(
      permissionKeys,
      DatasetACLPermission.Edit,
      hasMaintainerPermissions,
    ),
    canImportExportDSL: hasResourcePermission(
      permissionKeys,
      DatasetACLPermission.ImportExportDSL,
      hasMaintainerPermissions,
    ),
    canPipelineTest: hasResourcePermission(
      permissionKeys,
      DatasetACLPermission.PipelineTest,
      hasMaintainerPermissions,
    ),
    canDocumentDownload: hasResourcePermission(
      permissionKeys,
      DatasetACLPermission.DocumentDownload,
      hasMaintainerPermissions,
    ),
    canRetrievalRecall: hasResourcePermission(
      permissionKeys,
      DatasetACLPermission.RetrievalRecall,
      hasMaintainerPermissions,
    ),
    canUse: hasResourcePermission(
      permissionKeys,
      DatasetACLPermission.Use,
      hasMaintainerPermissions,
    ),
    canDeleteFile: hasResourcePermission(
      permissionKeys,
      DatasetACLPermission.DeleteFile,
      hasMaintainerPermissions,
    ),
    canPipelineRelease: hasResourcePermission(
      permissionKeys,
      DatasetACLPermission.PipelineRelease,
      hasMaintainerPermissions,
    ),
    canDelete: hasResourcePermission(
      permissionKeys,
      DatasetACLPermission.Delete,
      hasMaintainerPermissions,
    ),
    canAccessConfig:
      Boolean(options?.isRbacEnabled) &&
      hasResourcePermission(
        permissionKeys,
        DatasetACLPermission.AccessConfig,
        hasMaintainerPermissions,
      ),
  }
}
