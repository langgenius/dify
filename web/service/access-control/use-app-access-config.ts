import type { AccessControlTemplateLanguage } from '@/i18n-config/language'
import type {
  RemoveAppAccessPolicyMemberBindingsRequest,
  ResourceOpenScope,
  UpdateAppUserAccessSettingsRequest,
} from '@/models/access-control'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { consoleClient, consoleQuery } from '@/service/client'

const NAME_SPACE = 'app-access-config'

export const useAppAccessRules = (appId: string, language: AccessControlTemplateLanguage) => {
  return useQuery(consoleQuery.rbacAccessConfig.apps.accessRules.queryOptions({
    input: {
      params: {
        appId,
      },
      query: {
        language,
      },
    },
  }))
}

export const useAppUserAccessSettings = (appId: string, language: AccessControlTemplateLanguage) => {
  return useQuery(consoleQuery.rbacAccessConfig.apps.userAccessSettings.queryOptions({
    input: {
      params: {
        appId,
      },
      query: {
        language,
      },
    },
  }))
}

export const useUpdateAppUserAccessSettings = (appId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'update-app-user-access-settings', appId],
    mutationFn: (payload: UpdateAppUserAccessSettingsRequest) => consoleClient.rbacAccessConfig.apps.updateUserAccessSettings({
      params: {
        appId,
        accountId: payload.accountId,
      },
      body: {
        access_policy_ids: payload.accessPolicyIds,
      },
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: consoleQuery.rbacAccessConfig.apps.userAccessSettings.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: consoleQuery.rbacAccessConfig.apps.accessRules.key(),
        }),
      ])
    },
  })
}

export const useRemoveAppAccessPolicyMemberBindings = (appId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'remove-app-access-policy-member-bindings', appId],
    mutationFn: (payload: RemoveAppAccessPolicyMemberBindingsRequest) => consoleClient.rbacAccessConfig.apps.removeMemberBindings({
      params: {
        appId,
        policyId: payload.accessPolicyId,
      },
      body: {
        account_ids: payload.accountIds,
      },
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: consoleQuery.rbacAccessConfig.apps.userAccessSettings.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: consoleQuery.rbacAccessConfig.apps.accessRules.key(),
        }),
      ])
    },
  })
}

export const useUpdateAppOpenScope = (appId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'update-app-open-scope', appId],
    mutationFn: (openScope: ResourceOpenScope) => consoleClient.rbacAccessConfig.apps.updateOpenScope({
      params: {
        appId,
      },
      body: {
        scope: openScope,
      },
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: consoleQuery.rbacAccessConfig.apps.userAccessSettings.key(),
        }),
      ])
    },
  })
}
