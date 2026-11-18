'use client'

import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AccessPointCard } from '@/app/components/base/access-point/card'
import { AccessPointUrl } from '@/app/components/base/access-point/url'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { getErrorMessage } from '@/utils/error-message'
import { useAccessPointStatusLabel } from '../shared/use-access-point-status-label'

type EnvironmentMcpCardProps = {
  appId: string
  environmentId: string
  canManageAccessPoint: boolean
  highlighted?: boolean
}

export function EnvironmentMcpCard({
  appId,
  environmentId,
  canManageAccessPoint,
  highlighted,
}: EnvironmentMcpCardProps) {
  const { t } = useTranslation(['appOverview', 'common', 'deployments', 'tools'])
  const queryClient = useQueryClient()
  const [showRegenerate, setShowRegenerate] = useState(false)
  const params = { app_id: appId, environment_id: environmentId }
  const access = consoleQuery.enterprise.appDeploy.accessService
  const serverQueryOptions = access.getEnvironmentMcpServer.queryOptions({ input: { params } })
  const serverQuery = useQuery(serverQueryOptions)
  const server = serverQuery.data
  // The setting row exists once a server code was issued; until then GET returns an empty server.
  const created = Boolean(server?.server_code)
  const onError = (error: unknown) => {
    toast.error(
      getErrorMessage(error) ?? t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }),
    )
  }
  const createMutation = useMutation(
    access.createEnvironmentMcpServer.mutationOptions({ context: { silent: true } }),
  )
  const updateMutation = useMutation(
    access.updateEnvironmentMcpServer.mutationOptions({
      context: { silent: true },
      scope: { id: `environment-mcp-toggle:${appId}:${environmentId}` },
      onSuccess: (updated) => queryClient.setQueryData(serverQueryOptions.queryKey, updated),
      onError,
    }),
  )
  const refreshMutation = useMutation(
    access.refreshEnvironmentMcpServer.mutationOptions({
      context: { silent: true },
      onSuccess: (updated) => queryClient.setQueryData(serverQueryOptions.queryKey, updated),
      onError,
    }),
  )

  const pendingEnabled = updateMutation.variables?.body.enabled
  const enabled =
    (createMutation.isPending || updateMutation.isPending) && pendingEnabled !== undefined
      ? pendingEnabled
      : Boolean(server?.enabled)
  const loading = serverQuery.isPending
  const unavailable = serverQuery.isError
  const status = loading
    ? 'loading'
    : unavailable
      ? 'unavailable'
      : enabled
        ? 'inService'
        : 'disabled'
  const statusLabel = useAccessPointStatusLabel(status)

  const handleEnabledChange = async (nextEnabled: boolean) => {
    if (!canManageAccessPoint) return

    let current = server
    if (!created) {
      try {
        current = await createMutation.mutateAsync({ params })
      } catch (error) {
        onError(error)
        return
      }
    }
    updateMutation.mutate({
      params,
      body: {
        enabled: nextEnabled,
        description: current?.description ?? '',
        parameters: current?.parameters ?? {},
      },
    })
  }

  return (
    <>
      <AccessPointCard
        title={t(($) => $['mcp.server.title'], { ns: 'tools' })}
        description={t(($) => $['studio.accessPoint.mcpDescription'], { ns: 'deployments' })}
        icon="i-custom-vender-integrations-mcp"
        status={status}
        statusLabel={statusLabel}
        highlighted={highlighted}
        switchDisabled={!canManageAccessPoint}
        switchLabel={t(($) => $['mcp.server.title'], { ns: 'tools' })}
        switchLoading={createMutation.isPending}
        onEnabledChange={
          loading || unavailable ? undefined : (value) => void handleEnabledChange(value)
        }
      >
        <AccessPointUrl
          label={t(($) => $['mcp.server.url'], { ns: 'tools' })}
          value={created ? (server?.url ?? '') : '***********'}
          enabled={enabled}
          copyDisabled={!created}
          loading={loading}
          unavailable={unavailable}
          unavailableLabel={t(($) => $['health.ENVIRONMENT_STATUS_FAILED'], {
            ns: 'deployments',
          })}
          showRegenerate
          regenerateLabel={t(($) => $['overview.appInfo.regenerate'], { ns: 'appOverview' })}
          regenerateDisabled={!canManageAccessPoint || !created}
          regenerating={refreshMutation.isPending}
          onRegenerate={() => setShowRegenerate(true)}
        />
      </AccessPointCard>

      <AlertDialog open={showRegenerate} onOpenChange={(open) => !open && setShowRegenerate(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $['overview.appInfo.regenerate'], { ns: 'appOverview' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $['mcp.server.reGen'], { ns: 'tools' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              onClick={() => {
                refreshMutation.mutate({ params })
                setShowRegenerate(false)
              }}
            >
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
