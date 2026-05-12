import type { BindingsPayload, GetAppAccessPolicyByAppIdResponse } from '@/models/access-control'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { get, put } from '../base'

const NAME_SPACE = 'dataset-access-config'

export const useDatasetAccessRules = (datasetId: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'dataset-access-rules', datasetId],
    queryFn: () => get<GetAppAccessPolicyByAppIdResponse>(`/workspaces/current/rbac/datasets/${datasetId}/access-policy`),
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
    onSuccess: (_, { datasetId }) => {
      queryClient.invalidateQueries({ queryKey: [NAME_SPACE, 'dataset-access-rules', datasetId] })
    },
  })
}
