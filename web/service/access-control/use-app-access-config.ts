import type { AccessControlTemplateLanguage } from '@/i18n-config/language'
import type { GetAppAccessPolicyByAppIdResponse } from '@/models/access-control'
import { useQuery } from '@tanstack/react-query'
import { get } from '../base'

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
