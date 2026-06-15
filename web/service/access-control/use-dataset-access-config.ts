import type { AccessControlTemplateLanguage } from '@/i18n-config/language'
import type { GetDatasetAccessPolicyByDatasetIdResponse } from '@/models/access-control'
import { useQuery } from '@tanstack/react-query'
import { get } from '../base'

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
