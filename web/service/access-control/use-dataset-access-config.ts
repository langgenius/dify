import type { AccessControlTemplateLanguage } from '@/i18n/language'
import type {
  RemoveResourceAccessPolicyMemberBindingsRequest,
  UpdateResourceUserAccessSettingsRequest,
} from '@/models/access-control'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { consoleClient, consoleQuery } from '@/service/console'
import { normalizeDatasetAccessMatrix, normalizeDatasetUserAccessPolicies } from './normalizers'

const NAME_SPACE = 'dataset-access-config'
const datasetRbacContract = consoleQuery.workspaces.current.rbac.datasets.byDatasetId
const datasetRbacClient = consoleClient.workspaces.current.rbac.datasets.byDatasetId

type DatasetAccessConfigQueryOptions = {
  enabled?: boolean
}

export const useDatasetAccessRules = (
  datasetId: string,
  language: AccessControlTemplateLanguage,
  options?: DatasetAccessConfigQueryOptions,
) => {
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

export const useDatasetUserAccessSettings = (
  datasetId: string,
  language: AccessControlTemplateLanguage,
  page: number,
  pageSize: number,
  options?: DatasetAccessConfigQueryOptions,
) => {
  return useQuery({
    ...datasetRbacContract.userAccessPolicies.get.queryOptions({
      input: {
        params: {
          dataset_id: datasetId,
        },
        query: {
          language,
          limit: pageSize,
          page,
          reverse: false,
        },
      },
    }),
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
    select: normalizeDatasetUserAccessPolicies,
  })
}

export const useDatasetResourceWhitelist = (
  datasetId: string,
  options?: DatasetAccessConfigQueryOptions,
) => {
  return useQuery({
    ...datasetRbacContract.whitelist.get.queryOptions({
      input: {
        params: {
          dataset_id: datasetId,
        },
      },
    }),
    enabled: options?.enabled ?? true,
  })
}

export const useDatasetResourceWhitelistConfig = (
  datasetId: string,
  options?: DatasetAccessConfigQueryOptions,
) => {
  return useQuery({
    ...datasetRbacContract.whitelistConfig.get.queryOptions({
      input: {
        params: {
          dataset_id: datasetId,
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
    mutationFn: (payload: UpdateResourceUserAccessSettingsRequest) =>
      datasetRbacClient.users.byTargetAccountId.accessPolicies.put({
        params: {
          dataset_id: datasetId,
          target_account_id: payload.accountId,
        },
        body: {
          access_policy_ids: payload.accessPolicyIds,
        },
      }),
    // Every access setting of this knowledge base can change with membership.
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: datasetRbacContract.key({ input: { params: { dataset_id: datasetId } } }),
      }),
  })
}

export const useRemoveDatasetAccessPolicyMemberBindings = (datasetId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'remove-dataset-access-policy-member-bindings', datasetId],
    mutationFn: (removals: RemoveResourceAccessPolicyMemberBindingsRequest[]) =>
      Promise.all(
        removals.map((removal) =>
          datasetRbacClient.accessPolicies.byPolicyId.memberBindings.delete({
            params: {
              dataset_id: datasetId,
              policy_id: removal.accessPolicyId,
            },
            body: {
              account_ids: removal.accountIds,
            },
          }),
        ),
      ),
    // Every access setting of this knowledge base can change with membership.
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: datasetRbacContract.key({ input: { params: { dataset_id: datasetId } } }),
      }),
  })
}

export const useUpdateDatasetAutomaticIncludeWorkspaceMembers = (datasetId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'update-dataset-automatic-include-workspace-members', datasetId],
    mutationFn: (automaticIncludeWorkspaceMembers: boolean) =>
      datasetRbacClient.whitelist.put({
        params: {
          dataset_id: datasetId,
        },
        body: {
          automatic_include_workspace_members: automaticIncludeWorkspaceMembers,
        },
      }),
    // Every access setting of this knowledge base can change with membership.
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: datasetRbacContract.key({ input: { params: { dataset_id: datasetId } } }),
      }),
  })
}
