import type { AccessControlTemplateLanguage } from '@/i18n-config/language'
import type { BindingsPayload, GetAppAccessPolicyByAppIdResponse } from '@/models/access-control'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'
import { appDetailQueryKeyPrefix } from '@/service/use-apps'
import { get, put } from '../base'

const NAME_SPACE = 'app-access-config'

export const useAppAccessRules = (appId: string, language: AccessControlTemplateLanguage) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'app-access-rules', appId, language],
    queryFn: () => get<GetAppAccessPolicyByAppIdResponse>(`/workspaces/current/rbac/apps/${appId}/access-policy`, {
      params: {
        language,
      },
    }),
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
    onSuccess: async (_, { appId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [NAME_SPACE, 'app-access-rules', appId] }),
        queryClient.invalidateQueries({ queryKey: [...appDetailQueryKeyPrefix, appId] }),
        queryClient.invalidateQueries({ queryKey: consoleQuery.apps.list.key() }),
      ])
    },
  })
}
