import type { AccessControlTemplateLanguage } from '@/i18n-config/language'
import type {
  RemoveAppAccessPolicyMemberBindingsRequest,
  UpdateAppUserAccessSettingsRequest,
} from '@/models/access-control'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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

export const useAppUserAccessSettings = (
  appId: string,
  language: AccessControlTemplateLanguage,
  page: number,
  pageSize: number,
) => {
  return useQuery({
    ...appRbacContract.userAccessPolicies.get.queryOptions({
      input: {
        params: {
          app_id: appId,
        },
        query: {
          language,
          limit: pageSize,
          page,
          reverse: false,
        },
      },
    }),
    placeholderData: keepPreviousData,
    select: normalizeAppUserAccessPolicies,
  })
}

export const useAppResourceWhitelist = (appId: string) => {
  return useQuery(
    appRbacContract.whitelist.get.queryOptions({
      input: {
        params: {
          app_id: appId,
        },
      },
    }),
  )
}

export const useAppResourceWhitelistConfig = (appId: string) => {
  return useQuery(
    appRbacContract.whitelistConfig.get.queryOptions({
      input: {
        params: {
          app_id: appId,
        },
      },
    }),
  )
}

export const useUpdateAppUserAccessSettings = (appId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'update-app-user-access-settings', appId],
    mutationFn: (payload: UpdateAppUserAccessSettingsRequest) =>
      appRbacClient.users.byTargetAccountId.accessPolicies.put({
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
        queryClient.invalidateQueries({
          queryKey: appRbacContract.whitelist.get.key({ type: 'query' }),
        }),
      ])
    },
  })
}

export const useRemoveAppAccessPolicyMemberBindings = (appId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'remove-app-access-policy-member-bindings', appId],
    mutationFn: (removals: RemoveAppAccessPolicyMemberBindingsRequest[]) =>
      Promise.all(
        removals.map((removal) =>
          appRbacClient.accessPolicies.byPolicyId.memberBindings.delete({
            params: {
              app_id: appId,
              policy_id: removal.accessPolicyId,
            },
            body: {
              account_ids: removal.accountIds,
            },
          }),
        ),
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: appRbacContract.userAccessPolicies.get.key({ type: 'query' }),
        }),
        queryClient.invalidateQueries({
          queryKey: appRbacContract.accessPolicy.get.key({ type: 'query' }),
        }),
        queryClient.invalidateQueries({
          queryKey: appRbacContract.whitelist.get.key({ type: 'query' }),
        }),
      ])
    },
  })
}

export const useUpdateAppAutomaticIncludeWorkspaceMembers = (appId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'update-app-automatic-include-workspace-members', appId],
    mutationFn: (automaticIncludeWorkspaceMembers: boolean) =>
      appRbacClient.whitelist.put({
        params: {
          app_id: appId,
        },
        body: {
          automatic_include_workspace_members: automaticIncludeWorkspaceMembers,
        },
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: appRbacContract.userAccessPolicies.get.key({ type: 'query' }),
        }),
        queryClient.invalidateQueries({
          queryKey: appRbacContract.whitelist.get.key({ type: 'query' }),
        }),
        queryClient.invalidateQueries({
          queryKey: appRbacContract.whitelistConfig.get.key({ type: 'query' }),
        }),
      ])
    },
  })
}
