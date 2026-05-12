import type { BindingsPayload, GetAppAccessPolicyByAppIdResponse } from '@/models/access-control'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { get, put } from '../base'

const NAME_SPACE = 'app-access-config'

export const useAppAccessRules = (appId: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'app-access-rules', appId],
    queryFn: () => get<GetAppAccessPolicyByAppIdResponse>(`/workspaces/current/rbac/apps/${appId}/access-policy`),
  })
}

export const useUpdateAppAccessRuleBindings = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'update-app-access-rule-bindings'],
    mutationFn: (data: { appId: string, policyId: string } & BindingsPayload) => {
      const { appId, policyId, ...payload } = data
      return put(`/workspaces/current/rbac/apps/${appId}/access-policies/${policyId}/bindings`, {
        body: payload,
      })
    },
    onSuccess: (_, { appId }) => {
      queryClient.invalidateQueries({ queryKey: [NAME_SPACE, 'app-access-rules', appId] })
    },
  })
}
