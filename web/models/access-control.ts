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
  id: 'string'
  name: 'string'
  groupSize: 5
}

export type AccessControlAccount = {
  id: 'string'
  name: 'string'
  email: 'string'
  avatar: 'string'
  avatarUrl: 'string'
}

export type SubjectGroup = { subjectId: string, subjectType: SubjectType, groupData: AccessControlGroup }
export type SubjectAccount = { subjectId: string, subjectType: SubjectType, accountData: AccessControlAccount }

export type Subject = SubjectGroup | SubjectAccount

export type Permission = {
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

export type RoleType = 'workspace' | 'app' | 'dataset'

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

export type Pagination = {
  total_count: number
  per_page: number
  current_page: number
  total_pages: number
}

export type PaginationParameters = {
  page?: number
  limit?: number
  reverse?: boolean
}

export type RoleListRequest = PaginationParameters & {
  include_owner?: number
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

export type AccessPolicyResourceType = 'app' | 'dataset'

export type AccessPolicyCategory = 'global_system_default' | 'global_custom'

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

export type BindingType = 'role' | 'account'

export type Bindings = {
  roles: Array<{
    role_id: string
    role_name: string
  }>
  accounts: Array<{
    account_id: string
    account_name: string
  }>
}

export type BindingsPayload = {
  role_ids: string[]
  account_ids: string[]
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
  member_id: string
  role_ids: string[]
}

export type RemoveBindingPayload = {
  policy_id: string
  resource_type: AccessPolicyResourceType
} & BindingsPayload

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
