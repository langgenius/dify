import type { AccessControlTemplateLanguage } from '@/i18n-config/language'
import type {
  GetAccessPolicyDetailResponse,
  GetAppAccessPolicyByAppIdResponse,
  GetAppUserAccessSettingsResponse,
  ResourceOpenScope,
  UpdateAppUserAccessSettingsRequest,
} from '@/models/access-control'
import { useMutation, useQuery } from '@tanstack/react-query'
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

export const useAppUserAccessSettings = (appId: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'app-user-access-settings', appId],
    queryFn: () => get<GetAppUserAccessSettingsResponse>(`/apps/${appId}/user-access-policies`),
  })
}

export const useUpdateAppUserAccessSettings = (appId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'update-app-user-access-settings', appId],
    mutationFn: (payload: UpdateAppUserAccessSettingsRequest) => put<GetAccessPolicyDetailResponse>(`/apps/${appId}/user-access-policies`, {
      body: {
        access_policy_ids: payload.accessPolicyIds,
      },
    }),
  })
}

export const useUpdateAppOpenScope = (appId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'update-app-open-scope', appId],
    mutationFn: (openScope: ResourceOpenScope) => put(`/apps/${appId}/open-scope`, {
      body: {
        scope: openScope,
      },
    }),
  })
}
