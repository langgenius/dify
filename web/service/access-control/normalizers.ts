import type {
  AccessPolicy,
  AccessPolicyResourceType,
  AccessPolicyWithBindings,
  GetAppAccessPolicyByAppIdResponse,
  GetAppUserAccessSettingsResponse,
  GetDatasetAccessPolicyByDatasetIdResponse,
  GetDatasetUserAccessSettingsResponse,
  ResourceOpenScope,
  ResourceUserAccessSetting,
  Role,
} from '@/models/access-control'

type GeneratedAccessMatrixItem = import('@dify/contracts/api/console/workspaces/types.gen').AccessMatrixItem
type GeneratedAccessPolicy = import('@dify/contracts/api/console/workspaces/types.gen').AccessPolicy
type GeneratedAccessPolicyAccount = import('@dify/contracts/api/console/workspaces/types.gen').AccessPolicyAccount
type GeneratedAccessPolicyRole = import('@dify/contracts/api/console/workspaces/types.gen').AccessPolicyRole
type GeneratedAppAccessMatrix = import('@dify/contracts/api/console/workspaces/types.gen').AppAccessMatrix
type GeneratedDatasetAccessMatrix = import('@dify/contracts/api/console/workspaces/types.gen').DatasetAccessMatrix
type GeneratedRbacRole = import('@dify/contracts/api/console/workspaces/types.gen').RbacRole
type GeneratedRbacRoleAccount = import('@dify/contracts/api/console/workspaces/types.gen').RbacRoleAccount
type GeneratedResourceUserAccessPoliciesResponse = import('@dify/contracts/api/console/workspaces/types.gen').ResourceUserAccessPoliciesResponse
type GeneratedResourceUserAccessPolicies = NonNullable<GeneratedResourceUserAccessPoliciesResponse['data']>[number]

const normalizeRoleCategory = (category?: string): Role['category'] => {
  if (category === 'global_system_default')
    return 'global_system_default'

  return 'global_custom'
}

const normalizeRoleType = (type?: string): Role['type'] => {
  if (type === 'app' || type === 'dataset')
    return type

  return 'workspace'
}

const normalizeRoleTag = (roleTag?: string): Role['role_tag'] => {
  if (roleTag === 'owner')
    return 'owner'

  return ''
}

const normalizeResourceType = (resourceType: string, fallback: AccessPolicyResourceType): AccessPolicyResourceType => {
  if (resourceType === 'app' || resourceType === 'dataset')
    return resourceType

  return fallback
}

const normalizeAccessPolicy = (
  policy: GeneratedAccessPolicy,
  fallbackResourceType: AccessPolicyResourceType,
): AccessPolicy => ({
  id: policy.id,
  tenant_id: policy.tenant_id ?? '',
  resource_type: normalizeResourceType(policy.resource_type, fallbackResourceType),
  policy_key: policy.policy_key ?? '',
  name: policy.name,
  description: policy.description ?? '',
  permission_keys: policy.permission_keys ?? [],
  is_builtin: policy.is_builtin ?? false,
  category: normalizeRoleCategory(policy.category),
  created_at: String(policy.created_at ?? 0),
  updated_at: String(policy.updated_at ?? 0),
})

const normalizeAccessPolicyRole = (role: GeneratedAccessPolicyRole) => ({
  role_id: role.role_id,
  role_name: role.role_name,
  binding_id: role.binding_id,
  is_locked: role.is_locked ?? false,
  role_tag: normalizeRoleTag(role.role_tag),
})

const normalizeAccessPolicyAccount = (account: GeneratedAccessPolicyAccount) => ({
  account_id: account.account_id,
  account_name: account.account_name,
  binding_id: account.binding_id,
  is_locked: account.is_locked ?? false,
  avatar: account.avatar ?? '',
})

const normalizeAccessMatrixItem = (
  item: GeneratedAccessMatrixItem,
  fallbackResourceType: AccessPolicyResourceType,
): AccessPolicyWithBindings | null => {
  if (!item.policy)
    return null

  return {
    policy: normalizeAccessPolicy(item.policy, fallbackResourceType),
    roles: (item.roles ?? []).map(normalizeAccessPolicyRole),
    accounts: (item.accounts ?? []).map(normalizeAccessPolicyAccount),
  }
}

const isAccessPolicyWithBindings = (item: AccessPolicyWithBindings | null): item is AccessPolicyWithBindings => {
  return item !== null
}

const normalizeResourceOpenScope = (scope: string): ResourceOpenScope => {
  if (scope === 'all')
    return 'all'

  return 'specific'
}

const normalizeAccount = (account: GeneratedRbacRoleAccount): ResourceUserAccessSetting['account'] => ({
  account_id: account.account_id,
  account_name: account.account_name ?? '',
  email: account.email ?? '',
  avatar: account.avatar ?? '',
})

const normalizeRole = (role: GeneratedRbacRole): ResourceUserAccessSetting['roles'][number] => ({
  id: role.id,
  type: normalizeRoleType(role.type),
  category: normalizeRoleCategory(role.category),
  name: role.name,
  is_builtin: role.is_builtin ?? false,
  permission_keys: role.permission_keys ?? [],
})

const normalizeResourceUserAccessSetting = (
  setting: GeneratedResourceUserAccessPolicies,
  fallbackResourceType: AccessPolicyResourceType,
): ResourceUserAccessSetting => ({
  account: normalizeAccount(setting.account),
  roles: (setting.roles ?? []).map(normalizeRole),
  access_policies: (setting.access_policies ?? []).map(policy => normalizeAccessPolicy(policy, fallbackResourceType)),
})

const normalizeResourceUserAccessPolicies = (
  response: GeneratedResourceUserAccessPoliciesResponse,
  fallbackResourceType: AccessPolicyResourceType,
): GetAppUserAccessSettingsResponse | GetDatasetUserAccessSettingsResponse => ({
  data: (response.data ?? []).map(setting => normalizeResourceUserAccessSetting(setting, fallbackResourceType)),
  scope: normalizeResourceOpenScope(response.scope),
})

export const normalizeAppAccessMatrix = (response: GeneratedAppAccessMatrix): GetAppAccessPolicyByAppIdResponse => ({
  app_id: response.app_id ?? '',
  items: (response.items ?? [])
    .map(item => normalizeAccessMatrixItem(item, 'app'))
    .filter(isAccessPolicyWithBindings),
})

export const normalizeDatasetAccessMatrix = (
  response: GeneratedDatasetAccessMatrix,
): GetDatasetAccessPolicyByDatasetIdResponse => ({
  dataset_id: response.dataset_id ?? '',
  items: (response.items ?? [])
    .map(item => normalizeAccessMatrixItem(item, 'dataset'))
    .filter(isAccessPolicyWithBindings),
})

export const normalizeAppUserAccessPolicies = (
  response: GeneratedResourceUserAccessPoliciesResponse,
): GetAppUserAccessSettingsResponse => {
  return normalizeResourceUserAccessPolicies(response, 'app')
}

export const normalizeDatasetUserAccessPolicies = (
  response: GeneratedResourceUserAccessPoliciesResponse,
): GetDatasetUserAccessSettingsResponse => {
  return normalizeResourceUserAccessPolicies(response, 'dataset')
}
