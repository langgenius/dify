export const ContactsImPlatformManagementScope = {
  Enterprise: 'enterprise',
  Workspace: 'workspace',
} as const

export type ContactsImPlatformManagementScope =
  (typeof ContactsImPlatformManagementScope)[keyof typeof ContactsImPlatformManagementScope]

export type ContactsImPlatformOrganizationContext = {
  organizationId: string
  workspaceId?: string
  managementScope: ContactsImPlatformManagementScope
  canManage: boolean
}
