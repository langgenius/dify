'use client'

import type { EnvironmentTrigger } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { TriggerWithProvider } from '@/app/components/workflow/block-selector/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AccessPointCard } from '@/app/components/base/access-point/card'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { useAllTriggerPlugins } from '@/service/use-triggers'
import { getErrorMessage } from '@/utils/error-message'
import { TriggerAccessPointList, TriggerAccessPointRow } from '../shared/trigger-access-point-list'
import { useAccessPointStatusLabel } from '../shared/use-access-point-status-label'

type EnvironmentProps = {
  appId: string
  environmentId: string
  canManageAccessPoint: boolean
}

function EnvironmentTriggerItem({
  appId,
  environmentId,
  canManageAccessPoint,
  trigger,
  triggerPlugins,
}: EnvironmentProps & { trigger: EnvironmentTrigger; triggerPlugins: TriggerWithProvider[] }) {
  const { t } = useTranslation(['common'])
  const queryClient = useQueryClient()
  const nodeId = trigger.node_id ?? ''
  const updateMutation = useMutation(
    consoleQuery.enterprise.appDeploy.accessService.updateEnvironmentTriggerNode.mutationOptions({
      context: { silent: true },
      scope: { id: `environment-trigger-node:${appId}:${environmentId}:${nodeId}` },
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey:
            consoleQuery.enterprise.appDeploy.accessService.listEnvironmentTriggers.queryKey({
              input: { params: { app_id: appId, environment_id: environmentId } },
            }),
        }),
      onError: (error) => {
        toast.error(
          getErrorMessage(error) ??
            t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }),
        )
      },
    }),
  )
  const pendingStatus = updateMutation.variables?.body.status
  const status = updateMutation.isPending && pendingStatus ? pendingStatus : trigger.status

  return (
    <TriggerAccessPointRow
      title={trigger.title}
      triggerType={trigger.trigger_type}
      providerName={trigger.provider_name}
      enabled={status === 'enabled'}
      canManageAccessPoint={canManageAccessPoint}
      triggerPlugins={triggerPlugins}
      onEnabledChange={(nextEnabled) =>
        updateMutation.mutate({
          params: { app_id: appId, environment_id: environmentId, node_id: nodeId },
          body: { status: nextEnabled ? 'enabled' : 'disabled' },
        })
      }
    />
  )
}

export function EnvironmentTriggerCard({
  appId,
  environmentId,
  canManageAccessPoint,
  highlighted,
}: EnvironmentProps & { highlighted?: boolean }) {
  const { t } = useTranslation(['common', 'deployments', 'navigation'])
  const queryClient = useQueryClient()
  const access = consoleQuery.enterprise.appDeploy.accessService
  const input = { params: { app_id: appId, environment_id: environmentId } }
  const settingQueryOptions = access.getEnvironmentTrigger.queryOptions({ input })
  const settingQuery = useQuery(settingQueryOptions)
  const triggersQuery = useQuery(access.listEnvironmentTriggers.queryOptions({ input }))
  const { data: triggerPlugins = [] } = useAllTriggerPlugins()
  // Unlike Built-in, a deployed environment runs triggers only after this switch is on.
  const settingMutation = useMutation(
    access.updateEnvironmentTrigger.mutationOptions({
      context: { silent: true },
      scope: { id: `environment-trigger-toggle:${appId}:${environmentId}` },
      onSuccess: (updated) => queryClient.setQueryData(settingQueryOptions.queryKey, updated),
      onError: (error) => {
        toast.error(
          getErrorMessage(error) ??
            t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }),
        )
      },
    }),
  )
  const triggers = triggersQuery.data?.data ?? []
  const pendingEnabled = settingMutation.variables?.body.enabled
  const enabled =
    settingMutation.isPending && pendingEnabled !== undefined
      ? pendingEnabled
      : Boolean(settingQuery.data?.enabled)
  const loading = settingQuery.isPending || triggersQuery.isPending
  const unavailable = settingQuery.isError || triggersQuery.isError
  const status = loading
    ? 'loading'
    : unavailable
      ? 'unavailable'
      : enabled
        ? 'inService'
        : 'disabled'
  const statusLabel = useAccessPointStatusLabel(status)

  return (
    <AccessPointCard
      title={t(($) => $['settings.trigger'], { ns: 'navigation' })}
      description={t(($) => $['studio.accessPoint.triggerDescription'], { ns: 'deployments' })}
      icon="i-custom-vender-integrations-trigger"
      status={status}
      statusLabel={statusLabel}
      highlighted={highlighted}
      switchDisabled={!canManageAccessPoint}
      switchLabel={t(($) => $['settings.trigger'], { ns: 'navigation' })}
      onEnabledChange={
        loading || unavailable
          ? undefined
          : (nextEnabled) => settingMutation.mutate({ ...input, body: { enabled: nextEnabled } })
      }
    >
      <TriggerAccessPointList
        loading={loading}
        active={!loading && !unavailable}
        enabledCount={triggers.filter((trigger) => trigger.status === 'enabled').length}
        total={triggers.length}
      >
        {triggers.map((trigger) => (
          <EnvironmentTriggerItem
            key={trigger.node_id}
            appId={appId}
            environmentId={environmentId}
            canManageAccessPoint={canManageAccessPoint}
            trigger={trigger}
            triggerPlugins={triggerPlugins}
          />
        ))}
      </TriggerAccessPointList>
    </AccessPointCard>
  )
}
