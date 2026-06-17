import type { AccessControlTemplateLanguage } from '@/i18n-config/language'
import type {
  RemoveDatasetAccessPolicyMemberBindingsRequest,
  ResourceOpenScope,
  UpdateDatasetUserAccessSettingsRequest,
} from '@/models/access-control'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { consoleClient, consoleQuery } from '@/service/client'

const NAME_SPACE = 'dataset-access-config'

type DatasetAccessConfigQueryOptions = {
  enabled?: boolean
}

export const useDatasetAccessRules = (datasetId: string, language: AccessControlTemplateLanguage, options?: DatasetAccessConfigQueryOptions) => {
  return useQuery({
    ...consoleQuery.rbacAccessConfig.datasets.accessRules.queryOptions({
      input: {
        params: {
          datasetId,
        },
        query: {
          language,
        },
      },
    }),
    enabled: options?.enabled ?? true,
  })
}

export const useDatasetUserAccessSettings = (datasetId: string, language: AccessControlTemplateLanguage, options?: DatasetAccessConfigQueryOptions) => {
  return useQuery({
    ...consoleQuery.rbacAccessConfig.datasets.userAccessSettings.queryOptions({
      input: {
        params: {
          datasetId,
        },
        query: {
          language,
        },
      },
    }),
    enabled: options?.enabled ?? true,
  })
}

export const useUpdateDatasetUserAccessSettings = (datasetId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'update-dataset-user-access-settings', datasetId],
    mutationFn: (payload: UpdateDatasetUserAccessSettingsRequest) => consoleClient.rbacAccessConfig.datasets.updateUserAccessSettings({
      params: {
        datasetId,
        accountId: payload.accountId,
      },
      body: {
        access_policy_ids: payload.accessPolicyIds,
      },
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: consoleQuery.rbacAccessConfig.datasets.userAccessSettings.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: consoleQuery.rbacAccessConfig.datasets.accessRules.key(),
        }),
      ])
    },
  })
}

export const useRemoveDatasetAccessPolicyMemberBindings = (datasetId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'remove-dataset-access-policy-member-bindings', datasetId],
    mutationFn: (payload: RemoveDatasetAccessPolicyMemberBindingsRequest) => consoleClient.rbacAccessConfig.datasets.removeMemberBindings({
      params: {
        datasetId,
        policyId: payload.accessPolicyId,
      },
      body: {
        account_ids: payload.accountIds,
      },
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: consoleQuery.rbacAccessConfig.datasets.userAccessSettings.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: consoleQuery.rbacAccessConfig.datasets.accessRules.key(),
        }),
      ])
    },
  })
}

export const useUpdateDatasetOpenScope = (datasetId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'update-dataset-open-scope', datasetId],
    mutationFn: (openScope: ResourceOpenScope) => consoleClient.rbacAccessConfig.datasets.updateOpenScope({
      params: {
        datasetId,
      },
      body: {
        scope: openScope,
      },
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: consoleQuery.rbacAccessConfig.datasets.userAccessSettings.key(),
        }),
      ])
    },
  })
}
