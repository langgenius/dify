// TODO: replace with permissions fetched from the permissions API once available.
// Mock mapping from a workspace role key to the list of i18n keys describing
// what permission points that role grants.
export const ROLE_PERMISSION_KEYS: Record<string, string[]> = {
  owner: [
    'inviteMembers',
    'removeMembers',
    'assignRoles',
    'workspaceSettings',
    'manageBilling',
    'transferOwnership',
  ],
  admin: [
    'inviteMembers',
    'removeMembers',
    'assignRoles',
    'workspaceSettings',
    'manageBilling',
  ],
  editor: [
    'createApps',
    'editApps',
    'createDatasets',
    'editDatasets',
  ],
  dataset_operator: [
    'manageDatasets',
  ],
  normal: [
    'useApps',
  ],
}

export const getRolePermissionKeys = (roleKey: string): string[] => {
  return ROLE_PERMISSION_KEYS[roleKey] ?? []
}
