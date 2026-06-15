import type { AccessControlTemplateLanguage } from '@/i18n-config/language'
import type {
  GetAccessPolicyDetailResponse,
  GetDatasetAccessPolicyByDatasetIdResponse,
  GetDatasetUserAccessSettingsResponse,
  ResourceOpenScope,
  UpdateDatasetUserAccessSettingsRequest,
} from '@/models/access-control'
import { useMutation, useQuery } from '@tanstack/react-query'
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

export const useDatasetUserAccessSettings = (datasetId: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'dataset-user-access-settings', datasetId],
    queryFn: () => get<GetDatasetUserAccessSettingsResponse>(`/datasets/${datasetId}/user-access-policies`),
  })
}

export const useUpdateDatasetUserAccessSettings = (datasetId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'update-dataset-user-access-settings', datasetId],
    mutationFn: (payload: UpdateDatasetUserAccessSettingsRequest) => put<GetAccessPolicyDetailResponse>(`/datasets/${datasetId}/user-access-policies`, {
      body: {
        access_policy_ids: payload.accessPolicyIds,
      },
    }),
  })
}

export const useUpdateDatasetOpenScope = (datasetId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'update-dataset-open-scope', datasetId],
    mutationFn: (openScope: ResourceOpenScope) => put(`/datasets/${datasetId}/open-scope`, {
      body: {
        scope: openScope,
      },
    }),
  })
}
