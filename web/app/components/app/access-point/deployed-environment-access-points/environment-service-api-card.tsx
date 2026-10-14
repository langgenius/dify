'use client'

import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { ServiceApiCardView } from '../shared/service-api-card-view'

type EnvironmentServiceApiCardProps = {
  appId: string
  environmentId: string
  canManageAccessPoint: boolean
  highlighted?: boolean
}

export function EnvironmentServiceApiCard({
  appId,
  environmentId,
  canManageAccessPoint,
  highlighted,
}: EnvironmentServiceApiCardProps) {
  const { t } = useTranslation(['common'])
  const { data: appMode } = useSuspenseQuery(
    consoleQuery.apps.byAppId.get.queryOptions({
      input: { params: { app_id: appId } },
      select: (appDetail) => appDetail.mode,
    }),
  )
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
      scope: {
        id: `environment-service-api-toggle:${appId}:${environmentId}`,
      },
      onError: () => {
        toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
      },
    }),
  )
  const pendingEnabled = apiMutation.variables?.body.enabled
  const optimisticEnabled =
    apiMutation.isPending && pendingEnabled !== undefined ? pendingEnabled : Boolean(api?.enabled)
  const running = apiQuery.isSuccess && optimisticEnabled
  const status = apiQuery.isPending
    ? 'loading'
    : apiQuery.isError
      ? 'unavailable'
      : running
        ? 'inService'
        : 'disabled'

  const handleEnabledChange = (enabled: boolean) => {
    if (!canManageAccessPoint) return

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
        canManage: canManageAccessPoint,
        disabled: !apiQuery.isSuccess,
      }}
      apiUrl={api?.base_url ?? ''}
      appMode={appMode}
      available={apiQuery.isSuccess}
      status={status}
      highlighted={highlighted}
      switchDisabled={!canManageAccessPoint}
      onEnabledChange={apiQuery.isSuccess ? handleEnabledChange : undefined}
    />
  )
}
