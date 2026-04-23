export type Permission = {
  id: string
  name: string
}

export type PermissionGroup = {
  id: string
  label: string
  items: Permission[]
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: 'general',
    label: 'General',
    items: [
      { id: 'manage_model_providers', name: 'Manage model providers' },
      { id: 'manage_members', name: 'Manage members' },
      { id: 'manage_roles_permissions', name: 'Manage roles & permissions' },
      { id: 'manage_billing', name: 'Manage billing' },
      { id: 'manage_data_sources', name: 'Manage data sources' },
      { id: 'manage_api_extensions', name: 'Manage API extensions' },
    ],
  },
  {
    id: 'apps',
    label: 'Apps',
    items: [
      { id: 'create_apps', name: 'Create apps' },
      { id: 'view_all_apps', name: 'View all apps' },
      { id: 'delete_any_app', name: 'Delete any app' },
    ],
  },
  {
    id: 'knowledge',
    label: 'Knowledge',
    items: [
      { id: 'create_knowledge_bases', name: 'Create knowledge bases' },
      { id: 'view_all_knowledge_bases', name: 'View all knowledge bases' },
      { id: 'delete_any_knowledge_base', name: 'Delete any knowledge base' },
    ],
  },
  {
    id: 'logs_audit',
    label: 'Logs & Audit',
    items: [
      { id: 'view_all_app_logs', name: 'View all app logs' },
      { id: 'cross_app_log_access', name: 'Cross-app log access' },
      { id: 'view_sensitive_fields', name: 'View sensitive fields' },
    ],
  },
  {
    id: 'plugins',
    label: 'Plugins',
    items: [
      { id: 'install_plugins', name: 'Install plugins' },
      { id: 'uninstall_plugins', name: 'Uninstall plugins' },
    ],
  },
]

export const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap(g => g.items)

export const PERMISSION_MAP: Record<string, Permission> = Object.fromEntries(
  ALL_PERMISSIONS.map(p => [p.id, p]),
)
