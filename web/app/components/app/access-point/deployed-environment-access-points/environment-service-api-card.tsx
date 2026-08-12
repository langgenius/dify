'use client'

import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { consoleQuery } from '@/service/client'
import { ServiceApiCardView } from '../shared/service-api-card-view'

type EnvironmentServiceApiCardProps = {
  appId: string
  environmentId: string
  canManage: boolean
  highlighted?: boolean
}

export function EnvironmentServiceApiCard({
  appId,
  environmentId,
  canManage,
  highlighted,
}: EnvironmentServiceApiCardProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const appMode = useAppStore((state) => state.appDetail?.mode)
  const params = {
    app_id: appId,
    environment_id: environmentId,
  }
  const apiQueryOptions =
    consoleQuery.enterprise.appDeploy.accessService.getEnvironmentApi.queryOptions({
      input: { params },
    })
  const apiQuery = useQuery(apiQueryOptions)
  const api = apiQuery.data
  const apiMutation = useMutation(
    consoleQuery.enterprise.appDeploy.accessService.updateEnvironmentApi.mutationOptions({
      onSuccess: (updatedApi) => {
        queryClient.setQueryData(apiQueryOptions.queryKey, updatedApi)
        toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
      },
      onError: () => {
        toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
      },
    }),
  )
  const running = Boolean(apiQuery.isSuccess && api?.enabled)
  const status = apiQuery.isPending
    ? 'loading'
    : apiQuery.isError
      ? 'unavailable'
      : running
        ? 'inService'
        : 'disabled'

  const handleEnabledChange = (enabled: boolean) => {
    if (!canManage) return

    apiMutation.mutate({
      params,
      body: { enabled },
    })
  }

  return (
    <ServiceApiCardView
      apiKeyButtonProps={{
        appId,
        environmentId,
        apiKeyCount: api?.api_key_count,
        canManage,
        disabled: !apiQuery.isSuccess,
      }}
      apiUrl={api?.base_url ?? ''}
      appMode={appMode}
      available={apiQuery.isSuccess}
      status={status}
      highlighted={highlighted}
      switchDisabled={!canManage}
      onEnabledChange={apiQuery.isSuccess ? handleEnabledChange : undefined}
      busy={apiMutation.isPending}
    />
  )
}
