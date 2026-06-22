import type { AccessControlTemplateLanguage } from '@/i18n-config/language'
import type {
  GetAccessPolicyDetailResponse,
  GetAppAccessPolicyByAppIdResponse,
  GetAppUserAccessSettingsResponse,
  GetDatasetAccessPolicyByDatasetIdResponse,
  GetDatasetUserAccessSettingsResponse,
  ResourceOpenScope,
} from '@/models/access-control'
import { type } from '@orpc/contract'
import { base } from '../base'

const appAccessRulesContract = base
  .route({
    path: '/workspaces/current/rbac/apps/{appId}/access-policy',
    method: 'GET',
  })
  .input(type<{
    params: {
      appId: string
    }
    query: {
      language: AccessControlTemplateLanguage
    }
  }>())
  .output(type<GetAppAccessPolicyByAppIdResponse>())

const appUserAccessSettingsContract = base
  .route({
    path: '/workspaces/current/rbac/apps/{appId}/user-access-policies',
    method: 'GET',
  })
  .input(type<{
    params: {
      appId: string
    }
    query: {
      language: AccessControlTemplateLanguage
    }
  }>())
  .output(type<GetAppUserAccessSettingsResponse>())

const updateAppUserAccessSettingsContract = base
  .route({
    path: '/workspaces/current/rbac/apps/{appId}/users/{accountId}/access-policies',
    method: 'PUT',
  })
  .input(type<{
    params: {
      appId: string
      accountId: string
    }
    body: {
      access_policy_ids: string[]
    }
  }>())
  .output(type<GetAccessPolicyDetailResponse>())

const removeAppAccessPolicyMemberBindingsContract = base
  .route({
    path: '/workspaces/current/rbac/apps/{appId}/access-policies/{policyId}/member-bindings',
    method: 'DELETE',
  })
  .input(type<{
    params: {
      appId: string
      policyId: string
    }
    body: {
      account_ids: string[]
    }
  }>())
  .output(type<unknown>())

const updateAppOpenScopeContract = base
  .route({
    path: '/workspaces/current/rbac/apps/{appId}/whitelist',
    method: 'PUT',
  })
  .input(type<{
    params: {
      appId: string
    }
    body: {
      scope: ResourceOpenScope
    }
  }>())
  .output(type<unknown>())

const datasetAccessRulesContract = base
  .route({
    path: '/workspaces/current/rbac/datasets/{datasetId}/access-policy',
    method: 'GET',
  })
  .input(type<{
    params: {
      datasetId: string
    }
    query: {
      language: AccessControlTemplateLanguage
    }
  }>())
  .output(type<GetDatasetAccessPolicyByDatasetIdResponse>())

const datasetUserAccessSettingsContract = base
  .route({
    path: '/workspaces/current/rbac/datasets/{datasetId}/user-access-policies',
    method: 'GET',
  })
  .input(type<{
    params: {
      datasetId: string
    }
    query: {
      language: AccessControlTemplateLanguage
    }
  }>())
  .output(type<GetDatasetUserAccessSettingsResponse>())

const updateDatasetUserAccessSettingsContract = base
  .route({
    path: '/workspaces/current/rbac/datasets/{datasetId}/users/{accountId}/access-policies',
    method: 'PUT',
  })
  .input(type<{
    params: {
      datasetId: string
      accountId: string
    }
    body: {
      access_policy_ids: string[]
    }
  }>())
  .output(type<GetAccessPolicyDetailResponse>())

const removeDatasetAccessPolicyMemberBindingsContract = base
  .route({
    path: '/workspaces/current/rbac/datasets/{datasetId}/access-policies/{policyId}/member-bindings',
    method: 'DELETE',
  })
  .input(type<{
    params: {
      datasetId: string
      policyId: string
    }
    body: {
      account_ids: string[]
    }
  }>())
  .output(type<unknown>())

const updateDatasetOpenScopeContract = base
  .route({
    path: '/workspaces/current/rbac/datasets/{datasetId}/whitelist',
    method: 'PUT',
  })
  .input(type<{
    params: {
      datasetId: string
    }
    body: {
      scope: ResourceOpenScope
    }
  }>())
  .output(type<unknown>())

export const rbacAccessConfigContract = {
  apps: {
    accessRules: appAccessRulesContract,
    userAccessSettings: appUserAccessSettingsContract,
    updateUserAccessSettings: updateAppUserAccessSettingsContract,
    removeMemberBindings: removeAppAccessPolicyMemberBindingsContract,
    updateOpenScope: updateAppOpenScopeContract,
  },
  datasets: {
    accessRules: datasetAccessRulesContract,
    userAccessSettings: datasetUserAccessSettingsContract,
    updateUserAccessSettings: updateDatasetUserAccessSettingsContract,
    removeMemberBindings: removeDatasetAccessPolicyMemberBindingsContract,
    updateOpenScope: updateDatasetOpenScopeContract,
  },
}
