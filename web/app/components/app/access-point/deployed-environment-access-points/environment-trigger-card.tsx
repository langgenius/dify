'use client'

import type { EnvironmentTrigger } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { Switch } from '@langgenius/dify-ui/switch'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AccessPointCard, AccessPointEmptyContent } from '@/app/components/base/access-point/card'
import { CopyFeedback } from '@/app/components/base/copy-feedback'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BlockEnum } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { getErrorMessage } from '@/utils/error-message'
import { useAccessPointStatusLabel } from '../shared/use-access-point-status-label'
import { EnvironmentTriggerLogs } from './environment-trigger-logs'

const TRIGGER_BLOCKS = {
  'trigger-plugin': BlockEnum.TriggerPlugin,
  'trigger-schedule': BlockEnum.TriggerSchedule,
  'trigger-webhook': BlockEnum.TriggerWebhook,
} as const

type TriggerType = keyof typeof TRIGGER_BLOCKS

function triggerType(trigger: EnvironmentTrigger): TriggerType {
  return trigger.trigger_type && trigger.trigger_type in TRIGGER_BLOCKS
    ? (trigger.trigger_type as TriggerType)
    : 'trigger-webhook'
}

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
}: EnvironmentProps & { trigger: EnvironmentTrigger }) {
  const { t } = useTranslation(['agentV2', 'appOverview', 'common', 'deployments', 'workflow'])
  const queryClient = useQueryClient()
  const nodeId = trigger.node_id ?? ''
  const type = triggerType(trigger)
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
  const enabled = status === 'enabled'
  // unauthorized and rate_limited are set by the platform; users only switch enabled and disabled.
  const switchable = status === 'enabled' || status === 'disabled'
  const statusLabel = enabled
    ? t(($) => $['agentDetail.access.status.inService'], { ns: 'agentV2' })
    : t(($) => $['overview.status.disable'], { ns: 'appOverview' })

  return (
    <div className="flex flex-col gap-1 rounded-lg px-2 py-1.5 hover:bg-state-base-hover">
      <div className="flex min-h-8 items-center gap-3">
        <span>
          <BlockIcon type={TRIGGER_BLOCKS[type]} size="md" />
        </span>
        <span className="shrink-0 system-sm-medium text-text-secondary">
          {t(($) => $[`blocks.${type}`], { ns: 'workflow' })}
        </span>
        <span
          className="min-w-0 flex-1 truncate system-xs-regular text-text-tertiary"
          title={nodeId}
        >
          {nodeId}
        </span>
        {type === 'trigger-webhook' && trigger.webhook_url && (
          <CopyFeedback content={trigger.webhook_url} />
        )}
        <span
          className={`flex shrink-0 items-center gap-1 system-xs-semibold-uppercase ${
            enabled ? 'text-text-secondary' : 'text-text-tertiary'
          }`}
        >
          <StatusDot size="small" status={enabled ? 'success' : 'disabled'} />
          {switchable ? statusLabel : status}
        </span>
        <Switch
          checked={enabled}
          disabled={!canManageAccessPoint || !switchable}
          aria-label={nodeId}
          onCheckedChange={(nextEnabled) =>
            updateMutation.mutate({
              params: { app_id: appId, environment_id: environmentId, node_id: nodeId },
              body: { status: nextEnabled ? 'enabled' : 'disabled' },
            })
          }
        />
      </div>
      {trigger.native_enabled && enabled && (
        <p className="ps-11 system-xs-regular text-text-warning">
          {t(($) => $['studio.accessPoint.triggerNativeEnabled'], { ns: 'deployments' })}
        </p>
      )}
    </div>
  )
}

export function EnvironmentTriggerCard({
  appId,
  environmentId,
  canManageAccessPoint,
  highlighted,
}: EnvironmentProps & { highlighted?: boolean }) {
  const { t } = useTranslation(['appLog', 'common', 'deployments', 'navigation'])
  const queryClient = useQueryClient()
  const [showLogs, setShowLogs] = useState(false)
  const access = consoleQuery.enterprise.appDeploy.accessService
  const input = { params: { app_id: appId, environment_id: environmentId } }
  const settingQueryOptions = access.getEnvironmentTrigger.queryOptions({ input })
  const settingQuery = useQuery(settingQueryOptions)
  const triggersQuery = useQuery(access.listEnvironmentTriggers.queryOptions({ input }))
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
  const enabledCount = triggers.filter((trigger) => trigger.status === 'enabled').length

  return (
    <>
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
        actions={
          <Button
            variant="secondary"
            disabled={loading || unavailable}
            onClick={() => setShowLogs(true)}
            className="flex items-center gap-1 px-3"
          >
            <span aria-hidden className="i-ri-file-list-3-line size-4" />
            {t(($) => $.title, { ns: 'appLog' })}
          </Button>
        }
      >
        {!loading && !unavailable && triggers.length === 0 && (
          <AccessPointEmptyContent>
            {t(($) => $['studio.accessPoint.environmentTriggerEmpty'], { ns: 'deployments' })}
          </AccessPointEmptyContent>
        )}
        {!loading && !unavailable && triggers.length > 0 && (
          <div className="flex flex-col px-4 py-3">
            <div className="flex h-6 items-center system-xs-medium-uppercase text-text-secondary">
              {t(($) => $['studio.accessPoint.triggerEnabledCount'], {
                ns: 'deployments',
                enabled: enabledCount,
                total: triggers.length,
              })}
            </div>
            <div className="mt-1 flex flex-col gap-1">
              {triggers.map((trigger) => (
                <EnvironmentTriggerItem
                  key={trigger.node_id}
                  appId={appId}
                  environmentId={environmentId}
                  canManageAccessPoint={canManageAccessPoint}
                  trigger={trigger}
                />
              ))}
            </div>
          </div>
        )}
      </AccessPointCard>
      {showLogs && (
        <EnvironmentTriggerLogs
          appId={appId}
          environmentId={environmentId}
          canManageAccessPoint={canManageAccessPoint}
          onHide={() => setShowLogs(false)}
        />
      )}
    </>
  )
}
