import type { AccessControlTemplateLanguage } from '@/i18n-config/language'

export const SubjectType = {
  GROUP: 'group',
  ACCOUNT: 'account',
} as const

export type SubjectType = typeof SubjectType[keyof typeof SubjectType]

export const AccessMode = {
  PUBLIC: 'public',
  SPECIFIC_GROUPS_MEMBERS: 'private',
  ORGANIZATION: 'private_all',
  EXTERNAL_MEMBERS: 'sso_verified',
} as const

export type AccessMode = typeof AccessMode[keyof typeof AccessMode]

export type AccessControlGroup = {
  id: string
  name: string
  groupSize: number
}

export type AccessControlAccount = {
  id: string
  name: string
  email: string
  avatar: string
  avatarUrl: string
}

export type SubjectGroup = { subjectId: string, subjectType: SubjectType, groupData: AccessControlGroup }
export type SubjectAccount = { subjectId: string, subjectType: SubjectType, accountData: AccessControlAccount }

export type Subject = SubjectGroup | SubjectAccount

type Permission = {
  key: string
  name: string
  description: string
}
export type PermissionGroup = {
  group_key: string
  group_name: string
  description: string
  permissions: Permission[]
}

export type PermissionGroups = {
  groups: PermissionGroup[]
}

export type PermissionKey = string

type RoleType = 'workspace' | 'app' | 'dataset'

export type RoleCategory = 'global_system_default' | 'global_custom'

export type Role = {
  id: string
  tenant_id: string
  type: RoleType
  category: RoleCategory
  name: string
  description: string
  is_builtin: boolean
  permission_keys: PermissionKey[]
  role_tag: 'owner' | '' // Used for identifying the unique owner role, which has some special handlings
}

type Pagination = {
  total_count: number
  per_page: number
  current_page: number
  total_pages: number
}

type PaginationParameters = {
  page?: number
  limit?: number
  reverse?: boolean
}

export type RoleListRequest = PaginationParameters & {
  include_owner?: 1 | 0
  language?: AccessControlTemplateLanguage
}

export type RoleListResponse = {
  data: Role[]
  pagination: Pagination
}

export type CreateRoleRequest = {
  name: string
  description?: string
  permission_keys?: PermissionKey[]
}

export type UpdateRolesRequest = {
  id: string
  name: string
  description?: string
  permission_keys?: PermissionKey[]
}

export type CopyWorkspaceRoleRequest = {
  roleId: string
  copy_member: boolean
}

export type WorkspaceAccessRulesRequest = {
  language?: AccessControlTemplateLanguage
} & PaginationParameters

export type AccessPolicyResourceType = 'app' | 'dataset'

type AccessPolicyCategory = 'global_system_default' | 'global_custom'

export type AccessPolicy = {
  id: string
  tenant_id: string
  resource_type: AccessPolicyResourceType
  policy_key: string
  name: string
  description: string
  permission_keys: PermissionKey[]
  is_builtin: boolean
  category: AccessPolicyCategory
  created_at: string
  updated_at: string
}

export type CreateAccessPolicyRequest = {
  name: string
  description?: string
  permission_keys?: PermissionKey[]
}

export type UpdateAccessPolicyRequest = {
  id: string
  name: string
  description?: string
  permission_keys?: PermissionKey[]
}

type Bindings = {
  roles: Array<{
    role_id: string
    role_name: string
    binding_id: string
    is_locked: boolean
    role_tag: 'owner' | '' // Used for identifying the unique owner role, which has some special handlings
  }>
  accounts: Array<{
    account_id: string
    account_name: string
    binding_id: string
    is_locked: boolean
    avatar?: string
  }>
}

export type AccessPolicyWithBindings = {
  policy: AccessPolicy
} & Bindings

export type GetAppAccessPolicyByAppIdResponse = {
  app_id: string
  items: AccessPolicyWithBindings[]
}

export type GetDatasetAccessPolicyByDatasetIdResponse = {
  dataset_id: string
  items: AccessPolicyWithBindings[]
}

export type GetAppAccessPoliciesResponse = {
  items: AccessPolicyWithBindings[]
  pagination: Pagination
}

export type GetDatasetAccessPoliciesResponse = {
  items: AccessPolicyWithBindings[]
  pagination: Pagination
}

export type RolesOfMemberResponse = {
  account_id: string
  roles: Role[]
}

export type UpdateRolesOfMemberRequest = {
  memberId: string
  roleIds: string[]
}

type WorkspacePermissionKeys = {
  permission_keys: string[]
}

type ResourcePermissionKeys = {
  default_permission_keys: string[]
  overrides: Array<{
    resource_id: string
    permission_keys: string[]
  }>
}

export type PermissionKeysResponse = {
  workspace: WorkspacePermissionKeys
  app: ResourcePermissionKeys
  dataset: ResourcePermissionKeys
}

export type GetMembersOfRoleRequest = {
  roleId: string
} & PaginationParameters

type Account = {
  account_id: string
  account_name: string
  email?: string
  avatar?: string
}

export type ResourceUserAccessSetting = {
  account: Account
  roles: Omit<Role, 'tenant_id' | 'description' | 'role_tag'>[]
  access_policies: Omit<AccessPolicy, 'created_at' | 'updated_at'>[]
}

type ResourceUserAccessSettingsResponse = {
  data: ResourceUserAccessSetting[]
  scope: ResourceOpenScope
}

export type GetMembersOfRoleResponse = {
  data: Account[]
  pagination: Pagination
}

export type GetAppUserAccessSettingsResponse = ResourceUserAccessSettingsResponse

export type GetDatasetUserAccessSettingsResponse = ResourceUserAccessSettingsResponse

type UpdateResourceUserAccessSettingsRequest = {
  accountId: string
  accessPolicyIds: string[]
}

export type UpdateAppUserAccessSettingsRequest = UpdateResourceUserAccessSettingsRequest

export type UpdateDatasetUserAccessSettingsRequest = UpdateResourceUserAccessSettingsRequest

type RemoveResourceAccessPolicyMemberBindingsRequest = {
  accessPolicyId: string
  accountIds: string[]
}

export type RemoveAppAccessPolicyMemberBindingsRequest = RemoveResourceAccessPolicyMemberBindingsRequest

export type RemoveDatasetAccessPolicyMemberBindingsRequest = RemoveResourceAccessPolicyMemberBindingsRequest

export type ResourceOpenScope = 'all' | 'specific'
