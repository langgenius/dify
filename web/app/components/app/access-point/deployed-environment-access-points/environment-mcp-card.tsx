'use client'

import type { MCPServerFormValue } from '@/app/components/tools/mcp/mcp-server-form'
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
import { Button } from '@langgenius/dify-ui/button'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AccessPointCard, AccessPointEmptyContent } from '@/app/components/base/access-point/card'
import { AccessPointUrl } from '@/app/components/base/access-point/url'
import { MCPServerForm } from '@/app/components/tools/mcp/mcp-server-form'
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
  const [showForm, setShowForm] = useState(false)
  const [showRegenerate, setShowRegenerate] = useState(false)
  const params = { app_id: appId, environment_id: environmentId }
  const access = consoleQuery.enterprise.appDeploy.accessService
  const serverQueryOptions = access.getEnvironmentMcpServer.queryOptions({ input: { params } })
  const serverQuery = useQuery(serverQueryOptions)
  const server = serverQuery.data
  // The setting row exists once a server code was issued; until then GET returns no code.
  const created = Boolean(server?.server_code)
  const onError = (error: unknown) => {
    toast.error(
      getErrorMessage(error) ?? t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }),
    )
  }
  // Responses carry the serving revision's inputs; keep them when an update answers.
  const saveServer = (updated: typeof server) =>
    queryClient.setQueryData(serverQueryOptions.queryKey, updated)
  const createMutation = useMutation(
    access.createEnvironmentMcpServer.mutationOptions({ context: { silent: true } }),
  )
  const updateMutation = useMutation(
    access.updateEnvironmentMcpServer.mutationOptions({
      context: { silent: true },
      scope: { id: `environment-mcp-toggle:${appId}:${environmentId}` },
      onSuccess: saveServer,
      onError,
    }),
  )
  const refreshMutation = useMutation(
    access.refreshEnvironmentMcpServer.mutationOptions({
      context: { silent: true },
      onSuccess: saveServer,
      onError,
    }),
  )

  const pendingEnabled = updateMutation.variables?.body.enabled
  const enabled =
    updateMutation.isPending && pendingEnabled !== undefined
      ? pendingEnabled
      : Boolean(server?.enabled)
  const loading = serverQuery.isPending
  const unavailable = serverQuery.isError
  // MCP does not serve workflows that start from triggers.
  const unsupported = Boolean(server?.trigger_workflow)
  const status = loading
    ? 'loading'
    : unavailable
      ? 'unavailable'
      : unsupported
        ? 'unsupported'
        : enabled
          ? 'inService'
          : 'disabled'
  const statusLabel = useAccessPointStatusLabel(status)
  const usable = !loading && !unavailable && !unsupported

  const handleEnabledChange = (nextEnabled: boolean) => {
    if (!canManageAccessPoint) return
    // A new server needs its description first, as in the Built-in environment.
    if (nextEnabled && !created) {
      setShowForm(true)
      return
    }
    updateMutation.mutate({
      params,
      body: {
        enabled: nextEnabled,
        description: server?.description ?? '',
        parameters: server?.parameters ?? {},
      },
    })
  }

  const handleSubmit = async ({ description, parameters }: MCPServerFormValue) => {
    try {
      if (!created) await createMutation.mutateAsync({ params })
      await updateMutation.mutateAsync({
        params,
        body: { enabled: created ? Boolean(server?.enabled) : true, description, parameters },
      })
      setShowForm(false)
    } catch (error) {
      onError(error)
    }
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
        onEnabledChange={usable ? handleEnabledChange : undefined}
        actions={
          unsupported ? undefined : (
            <Button
              variant="secondary"
              disabled={!usable || !canManageAccessPoint}
              onClick={() => setShowForm(true)}
              className="flex items-center gap-1 px-3"
            >
              <span aria-hidden className="i-ri-draft-line size-4" />
              {created
                ? t(($) => $['mcp.server.edit'], { ns: 'tools' })
                : t(($) => $['mcp.server.addDescription'], { ns: 'tools' })}
            </Button>
          )
        }
      >
        {unsupported ? (
          <AccessPointEmptyContent>
            {t(($) => $['studio.accessPoint.mcpTriggerUnsupported'], { ns: 'deployments' })}
          </AccessPointEmptyContent>
        ) : (
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
        )}
      </AccessPointCard>

      {showForm && (
        <MCPServerForm
          show
          editing={created}
          defaultDescription={server?.description ?? ''}
          defaultParameters={server?.parameters}
          latestParams={server?.inputs}
          pending={createMutation.isPending || updateMutation.isPending}
          onHide={() => setShowForm(false)}
          onSubmit={handleSubmit}
        />
      )}

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
