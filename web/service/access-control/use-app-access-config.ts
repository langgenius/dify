import type { AccessControlTemplateLanguage } from '@/i18n-config/language'
import type {
  RemoveAppAccessPolicyMemberBindingsRequest,
  ResourceOpenScope,
  UpdateAppUserAccessSettingsRequest,
} from '@/models/access-control'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { consoleClient, consoleQuery } from '@/service/client'
import { normalizeAppAccessMatrix, normalizeAppUserAccessPolicies } from './normalizers'

const NAME_SPACE = 'app-access-config'
const appRbacContract = consoleQuery.workspaces.current.rbac.apps.byAppId
const appRbacClient = consoleClient.workspaces.current.rbac.apps.byAppId

export const useAppAccessRules = (appId: string, language: AccessControlTemplateLanguage) => {
  return useQuery({
    ...appRbacContract.accessPolicy.get.queryOptions({
      input: {
        params: {
          app_id: appId,
        },
        query: {
          language,
        },
      },
    }),
    select: normalizeAppAccessMatrix,
  })
}

export const useAppUserAccessSettings = (appId: string, language: AccessControlTemplateLanguage) => {
  return useQuery({
    ...appRbacContract.userAccessPolicies.get.queryOptions({
      input: {
        params: {
          app_id: appId,
        },
        query: {
          language,
        },
      },
    }),
    select: normalizeAppUserAccessPolicies,
  })
}

export const useUpdateAppUserAccessSettings = (appId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'update-app-user-access-settings', appId],
    mutationFn: (payload: UpdateAppUserAccessSettingsRequest) => appRbacClient.users.byTargetAccountId.accessPolicies.put({
      params: {
        app_id: appId,
        target_account_id: payload.accountId,
      },
      body: {
        access_policy_ids: payload.accessPolicyIds,
      },
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: appRbacContract.userAccessPolicies.get.key({ type: 'query' }),
        }),
        queryClient.invalidateQueries({
          queryKey: appRbacContract.accessPolicy.get.key({ type: 'query' }),
        }),
      ])
    },
  })
}

export const useRemoveAppAccessPolicyMemberBindings = (appId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'remove-app-access-policy-member-bindings', appId],
    mutationFn: (payload: RemoveAppAccessPolicyMemberBindingsRequest) => appRbacClient.accessPolicies.byPolicyId.memberBindings.delete({
      params: {
        app_id: appId,
        policy_id: payload.accessPolicyId,
      },
      body: {
        account_ids: payload.accountIds,
      },
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: appRbacContract.userAccessPolicies.get.key({ type: 'query' }),
        }),
        queryClient.invalidateQueries({
          queryKey: appRbacContract.accessPolicy.get.key({ type: 'query' }),
        }),
      ])
    },
  })
}

export const useUpdateAppOpenScope = (appId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'update-app-open-scope', appId],
    mutationFn: (openScope: ResourceOpenScope) => appRbacClient.whitelist.put({
      params: {
        app_id: appId,
      },
      body: {
        scope: openScope,
      },
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: appRbacContract.userAccessPolicies.get.key({ type: 'query' }),
        }),
      ])
    },
  })
}
