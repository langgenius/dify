import type { AccessControlTemplateLanguage } from '@/i18n-config/language'
import type {
  ResourceOpenScope,
  UpdateDatasetUserAccessSettingsRequest,
} from '@/models/access-control'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { consoleClient, consoleQuery } from '@/service/client'

const NAME_SPACE = 'dataset-access-config'

export const useDatasetAccessRules = (datasetId: string, language: AccessControlTemplateLanguage) => {
  return useQuery(consoleQuery.rbacAccessConfig.datasets.accessRules.queryOptions({
    input: {
      params: {
        datasetId,
      },
      query: {
        language,
      },
    },
  }))
}

export const useDatasetUserAccessSettings = (datasetId: string) => {
  return useQuery(consoleQuery.rbacAccessConfig.datasets.userAccessSettings.queryOptions({
    input: {
      params: {
        datasetId,
      },
    },
  }))
}

export const useUpdateDatasetUserAccessSettings = (datasetId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'update-dataset-user-access-settings', datasetId],
    mutationFn: (payload: UpdateDatasetUserAccessSettingsRequest) => consoleClient.rbacAccessConfig.datasets.updateUserAccessSettings({
      params: {
        datasetId,
        accountId: payload.accountId,
      },
      body: {
        access_policy_ids: payload.accessPolicyIds,
      },
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: consoleQuery.rbacAccessConfig.datasets.userAccessSettings.queryKey({
            input: {
              params: {
                datasetId,
              },
            },
          }),
        }),
        queryClient.invalidateQueries({
          queryKey: consoleQuery.rbacAccessConfig.datasets.accessRules.key(),
        }),
      ])
    },
  })
}

export const useUpdateDatasetOpenScope = (datasetId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'update-dataset-open-scope', datasetId],
    mutationFn: (openScope: ResourceOpenScope) => consoleClient.rbacAccessConfig.datasets.updateOpenScope({
      params: {
        datasetId,
      },
      body: {
        scope: openScope,
      },
    }),
  })
}
