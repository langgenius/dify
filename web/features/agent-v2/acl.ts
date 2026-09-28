import { hasPermission } from '@/utils/permission'

export const AgentPermission = {
  Create: 'agent.create',
  Preview: 'agent.acl.preview',
  Edit: 'agent.acl.edit',
  TestAndRun: 'agent.acl.test_and_run',
  ReleaseAndVersion: 'agent.acl.release_and_version',
  AccessPointView: 'agent.acl.access_point_view',
  AccessPointManage: 'agent.acl.access_point_manage',
  LogManage: 'agent.acl.log_manage',
  Monitor: 'agent.acl.monitor',
  AccessConfig: 'agent.acl.access_config',
  ImportExportDSL: 'agent.acl.import_export_dsl',
  Delete: 'agent.acl.delete',
} as const

export function getAgentACLCapabilities(permissionKeys: readonly string[] | undefined) {
  const canEdit = hasPermission(permissionKeys, AgentPermission.Edit)
  const canTestAndRun = hasPermission(permissionKeys, AgentPermission.TestAndRun)
  const canReleaseAndVersion = hasPermission(permissionKeys, AgentPermission.ReleaseAndVersion)

  return {
    canPreview: hasPermission(permissionKeys, AgentPermission.Preview),
    canEdit,
    canTestAndRun,
    canBuild: canEdit && canTestAndRun,
    canReleaseAndVersion,
    canConfigure: canEdit || canTestAndRun || canReleaseAndVersion,
    canViewAccessPoint: hasPermission(permissionKeys, AgentPermission.AccessPointView),
    canManageAccessPoint: hasPermission(permissionKeys, AgentPermission.AccessPointManage),
    canManageLogs: hasPermission(permissionKeys, AgentPermission.LogManage),
    canMonitor: hasPermission(permissionKeys, AgentPermission.Monitor),
    canAccessConfig: hasPermission(permissionKeys, AgentPermission.AccessConfig),
    canImportExportDSL: hasPermission(permissionKeys, AgentPermission.ImportExportDSL),
    canDelete: hasPermission(permissionKeys, AgentPermission.Delete),
  }
}

export function getAgentDefaultSection(capabilities: ReturnType<typeof getAgentACLCapabilities>) {
  if (capabilities.canConfigure) return 'configure'
  if (capabilities.canViewAccessPoint) return 'access'
  if (capabilities.canManageLogs) return 'logs'
  if (capabilities.canMonitor) return 'monitoring'
  if (capabilities.canAccessConfig) return 'access-config'
  return undefined
}

export function getAgentSectionAccess(capabilities: ReturnType<typeof getAgentACLCapabilities>) {
  return {
    configure: capabilities.canConfigure,
    access: capabilities.canViewAccessPoint,
    logs: capabilities.canManageLogs,
    monitoring: capabilities.canMonitor,
    'access-config': capabilities.canAccessConfig,
  }
}
