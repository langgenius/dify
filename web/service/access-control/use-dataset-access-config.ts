import type { AccessControlTemplateLanguage } from '@/i18n-config/language'
import type {
  RemoveDatasetAccessPolicyMemberBindingsRequest,
  ResourceOpenScope,
  UpdateDatasetUserAccessSettingsRequest,
} from '@/models/access-control'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { consoleClient, consoleQuery } from '@/service/client'
import { normalizeDatasetAccessMatrix, normalizeDatasetUserAccessPolicies } from './normalizers'

const NAME_SPACE = 'dataset-access-config'
const datasetRbacContract = consoleQuery.workspaces.current.rbac.datasets.byDatasetId
const datasetRbacClient = consoleClient.workspaces.current.rbac.datasets.byDatasetId

type DatasetAccessConfigQueryOptions = {
  enabled?: boolean
}

export const useDatasetAccessRules = (datasetId: string, language: AccessControlTemplateLanguage, options?: DatasetAccessConfigQueryOptions) => {
  return useQuery({
    ...datasetRbacContract.accessPolicy.get.queryOptions({
      input: {
        params: {
          dataset_id: datasetId,
        },
        query: {
          language,
        },
      },
    }),
    enabled: options?.enabled ?? true,
    select: normalizeDatasetAccessMatrix,
  })
}

export const useDatasetUserAccessSettings = (datasetId: string, language: AccessControlTemplateLanguage, options?: DatasetAccessConfigQueryOptions) => {
  return useQuery({
    ...datasetRbacContract.userAccessPolicies.get.queryOptions({
      input: {
        params: {
          dataset_id: datasetId,
        },
        query: {
          language,
        },
      },
    }),
    enabled: options?.enabled ?? true,
    select: normalizeDatasetUserAccessPolicies,
  })
}

export const useUpdateDatasetUserAccessSettings = (datasetId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'update-dataset-user-access-settings', datasetId],
    mutationFn: (payload: UpdateDatasetUserAccessSettingsRequest) => datasetRbacClient.users.byTargetAccountId.accessPolicies.put({
      params: {
        dataset_id: datasetId,
        target_account_id: payload.accountId,
      },
      body: {
        access_policy_ids: payload.accessPolicyIds,
      },
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: datasetRbacContract.userAccessPolicies.get.key({ type: 'query' }),
        }),
        queryClient.invalidateQueries({
          queryKey: datasetRbacContract.accessPolicy.get.key({ type: 'query' }),
        }),
      ])
    },
  })
}

export const useRemoveDatasetAccessPolicyMemberBindings = (datasetId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'remove-dataset-access-policy-member-bindings', datasetId],
    mutationFn: (payload: RemoveDatasetAccessPolicyMemberBindingsRequest) => datasetRbacClient.accessPolicies.byPolicyId.memberBindings.delete({
      params: {
        dataset_id: datasetId,
        policy_id: payload.accessPolicyId,
      },
      body: {
        account_ids: payload.accountIds,
      },
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: datasetRbacContract.userAccessPolicies.get.key({ type: 'query' }),
        }),
        queryClient.invalidateQueries({
          queryKey: datasetRbacContract.accessPolicy.get.key({ type: 'query' }),
        }),
      ])
    },
  })
}

export const useUpdateDatasetOpenScope = (datasetId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'update-dataset-open-scope', datasetId],
    mutationFn: (openScope: ResourceOpenScope) => datasetRbacClient.whitelist.put({
      params: {
        dataset_id: datasetId,
      },
      body: {
        scope: openScope,
      },
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: datasetRbacContract.userAccessPolicies.get.key({ type: 'query' }),
        }),
      ])
    },
  })
}
