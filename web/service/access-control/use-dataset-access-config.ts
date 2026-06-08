import type { AccessControlTemplateLanguage } from '@/i18n-config/language'
import type { BindingsPayload, GetDatasetAccessPolicyByDatasetIdResponse } from '@/models/access-control'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { datasetDetailQueryKeyPrefix, datasetListQueryKey } from '@/service/knowledge/use-dataset'
import { get, put } from '../base'

const NAME_SPACE = 'dataset-access-config'

export const useDatasetAccessRules = (datasetId: string, language: AccessControlTemplateLanguage) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'dataset-access-rules', datasetId, language],
    queryFn: () => get<GetDatasetAccessPolicyByDatasetIdResponse>(`/workspaces/current/rbac/datasets/${datasetId}/access-policy`, {
      params: {
        language,
      },
    }),
  })
}

export const useUpdateDatasetAccessRuleBindings = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'update-dataset-access-rule-bindings'],
    mutationFn: (data: { datasetId: string, policyId: string } & BindingsPayload) => {
      const { datasetId, policyId, ...payload } = data
      return put(`/workspaces/current/rbac/datasets/${datasetId}/access-policies/${policyId}/bindings`, {
        body: payload,
      })
    },
    onSuccess: async (_, { datasetId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [NAME_SPACE, 'dataset-access-rules', datasetId] }),
        queryClient.invalidateQueries({ queryKey: [...datasetDetailQueryKeyPrefix, datasetId] }),
        queryClient.invalidateQueries({ queryKey: datasetListQueryKey }),
      ])
    },
  })
}
