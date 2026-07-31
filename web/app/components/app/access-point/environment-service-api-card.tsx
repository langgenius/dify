'use client'

import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import { consoleQuery } from '@/service/client'
import { AccessPointCard } from './access-point-card'
import { AccessPointUrl } from './access-point-url'
import { ApiSecretKeyButton } from './api-secret-key-button'

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
  const status = apiQuery.isSuccess ? (running ? 'inService' : 'disabled') : 'unavailable'
  const statusLabel = apiQuery.isSuccess
    ? running
      ? t(($) => $['agentDetail.access.status.inService'], { ns: 'agentV2' })
      : t(($) => $['overview.status.disable'], { ns: 'appOverview' })
    : t(($) => $['health.ENVIRONMENT_STATUS_FAILED'], { ns: 'deployments' })

  const handleEnabledChange = (enabled: boolean) => {
    if (!canManage) return

    apiMutation.mutate({
      params,
      body: { enabled },
    })
  }

  return (
    <AccessPointCard
      title={t(($) => $['agentDetail.access.serviceApi.title'], { ns: 'agentV2' })}
      description={t(($) => $['studio.accessPoint.apiDescription'], {
        ns: 'deployments',
      })}
      icon="i-custom-vender-knowledge-api-aggregate"
      status={status}
      statusLabel={statusLabel}
      highlighted={highlighted}
      switchDisabled={!canManage}
      switchLabel={t(($) => $['overview.apiInfo.title'], { ns: 'appOverview' })}
      onEnabledChange={apiQuery.isSuccess ? handleEnabledChange : undefined}
      busy={apiMutation.isPending}
      actions={
        <>
          <ApiSecretKeyButton
            appId={appId}
            environmentId={environmentId}
            apiKeyCount={api?.api_key_count}
            canManage={canManage}
            disabled={!running}
          />
          <Button
            variant="secondary"
            disabled={!apiQuery.isSuccess}
            nativeButton={false}
            render={<Link href={`/app/${appId}/develop`} />}
            className="flex items-center gap-1"
          >
            <span aria-hidden className="i-ri-book-open-line size-4" />
            {t(($) => $['overview.apiInfo.doc'], { ns: 'appOverview' })}
            <span aria-hidden className="i-ri-arrow-right-up-line size-3.5" />
          </Button>
        </>
      }
    >
      <AccessPointUrl
        label={t(($) => $['overview.apiInfo.accessibleAddress'], {
          ns: 'appOverview',
        })}
        value={api?.base_url ?? ''}
        enabled={running}
        loading={apiQuery.isPending}
        unavailable={apiQuery.isError}
        unavailableLabel={t(($) => $['health.ENVIRONMENT_STATUS_FAILED'], {
          ns: 'deployments',
        })}
      />
    </AccessPointCard>
  )
}
