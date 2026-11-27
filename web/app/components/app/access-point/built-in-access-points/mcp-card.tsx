'use client'

import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { MutationFilters } from '@tanstack/react-query'
import type { PublishedWorkflow } from '../shared/utils'
import type { AccessPointAvailability } from '@/app/components/base/access-point/status'
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
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isPlainObject } from 'es-toolkit/predicate'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AccessPointCard } from '@/app/components/base/access-point/card'
import { AccessPointUrl } from '@/app/components/base/access-point/url'
import MCPServerModal from '@/app/components/tools/mcp/mcp-server-modal'
import { selectMCPServerDetail } from '@/app/components/tools/utils/query-select'
import { BlockEnum } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { getErrorMessage } from '@/utils/error-message'
import { useAccessPointStatusLabel } from '../shared/use-access-point-status-label'
import { getPublishedWorkflowNodes, isAdvancedApp } from '../shared/utils'

type MCPAccessPointCardProps = {
  appInfo: AppDetailWithSite
  canManageAccessPoint: boolean
  highlighted?: boolean
  availability: AccessPointAvailability
  workflow: PublishedWorkflow
}

export function MCPAccessPointCard({
  appInfo,
  canManageAccessPoint,
  highlighted,
  availability,
  workflow,
}: MCPAccessPointCardProps) {
  const { t } = useTranslation(['appOverview', 'common', 'deployments', 'tools'])
  const advancedApp = isAdvancedApp(appInfo)
  const basicApp = !advancedApp
  const [showServerModal, setShowServerModal] = useState(false)
  const [regenerationAppId, setRegenerationAppId] = useState<string | null>(null)
  const basicConfig = appInfo.model_config
  const basicAppInputForm = basicConfig?.user_input_form
  const queryClient = useQueryClient()
  const serverDetailQueryOptions = consoleQuery.apps.byAppId.server.get.queryOptions({
    input: { params: { app_id: appInfo.id } },
    enabled: Boolean(appInfo.id),
    select: selectMCPServerDetail,
  })
  const { data: detail, isPending: serverDetailLoading } = useQuery(serverDetailQueryOptions)
  const updateServerMutation = useMutation(
    consoleQuery.apps.byAppId.server.put.mutationOptions({
      meta: { errorToast: false },
      scope: {
        id: `app-mcp-toggle:${appInfo.id}`,
      },
      onError: (error) => {
        toast.error(
          getErrorMessage(error) ??
            t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }),
        )
      },
    }),
  )
  const rotateServerCode = consoleQuery.apps.byAppId.server.refresh.post
  const rotationFilter: MutationFilters = {
    mutationKey: rotateServerCode.mutationKey(),
    exact: true,
    predicate: ({ state: { variables } }) =>
      isPlainObject(variables) && variables.params?.app_id === appInfo.id,
  }
  const regenerating = useIsMutating(rotationFilter) > 0
  const { mutate: refreshServerCode } = useMutation(
    rotateServerCode.mutationOptions({
      meta: { errorToast: false },
      onSuccess: (_server, { params }) => {
        setRegenerationAppId((current) => (current === params.app_id ? null : current))
      },
      onError: (error) => {
        toast.error(
          getErrorMessage(error) ??
            t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }),
        )
      },
    }),
  )

  const serverPublished = Boolean(detail?.id)
  const serverActivated = detail?.status === 'active'
  const pendingStatus = updateServerMutation.variables?.body.status
  const activated =
    updateServerMutation.isPending && pendingStatus != null
      ? pendingStatus === 'active'
      : serverActivated
  const serverUrl = serverPublished
    ? `${appInfo.api_base_url.replace(/\/v1$/, '')}/mcp/server/${detail?.server_code}/mcp`
    : '***********'
  const workflowNodes = getPublishedWorkflowNodes(workflow)
  const loading = serverDetailLoading || availability === 'loading'
  const unavailable = !loading && availability === 'unavailable'

  const basicAppInputs = useMemo(() => {
    if (!basicApp || !basicAppInputForm) return []

    return basicAppInputForm.map((item) => {
      const [type = 'text-input'] = Object.keys(item)
      const [config = {}] = Object.values(item) as object[]
      return {
        ...config,
        type,
      }
    })
  }, [basicApp, basicAppInputForm])

  const latestParams = useMemo(() => {
    if (!advancedApp) return basicAppInputs
    const startNode = workflowNodes.find((node) => node.data.type === BlockEnum.Start)
    return (
      (
        startNode?.data as {
          variables?: Array<{ variable: string; label: string }>
        }
      )?.variables ?? []
    )
  }, [advancedApp, basicAppInputs, workflowNodes])

  const handleStatusChange = (enabled: boolean) => {
    if (!canManageAccessPoint || loading || unavailable) return
    if (enabled && !serverPublished) {
      setShowServerModal(true)
      return
    }

    updateServerMutation.mutate({
      params: {
        app_id: appInfo.id,
      },
      body: {
        id: detail?.id || '',
        description: detail?.description || '',
        parameters: detail?.parameters || {},
        status: enabled ? 'active' : 'inactive',
      },
    })
  }

  const handleRegenerate = () => {
    if (!canManageAccessPoint || !detail?.id || queryClient.isMutating(rotationFilter)) return
    refreshServerCode({ params: { app_id: appInfo.id } })
  }

  const status = loading
    ? 'loading'
    : unavailable
      ? 'unavailable'
      : activated
        ? 'inService'
        : 'disabled'
  const statusLabel = useAccessPointStatusLabel(status)

  return (
    <>
      <AccessPointCard
        title={t(($) => $['mcp.server.title'], { ns: 'tools' })}
        description={t(($) => $['studio.accessPoint.mcpDescription'], {
          ns: 'deployments',
        })}
        icon="i-custom-vender-integrations-mcp"
        status={status}
        statusLabel={statusLabel}
        highlighted={highlighted}
        switchDisabled={!canManageAccessPoint}
        switchLabel={t(($) => $['mcp.server.title'], { ns: 'tools' })}
        onEnabledChange={loading || unavailable ? undefined : handleStatusChange}
        actions={
          <Button
            variant="secondary"
            disabled={loading || unavailable || !canManageAccessPoint}
            onClick={() => setShowServerModal(true)}
            className="flex items-center gap-1 px-3"
          >
            <span aria-hidden className="i-ri-draft-line size-4" />
            {serverPublished
              ? t(($) => $['mcp.server.edit'], { ns: 'tools' })
              : t(($) => $['mcp.server.addDescription'], { ns: 'tools' })}
          </Button>
        }
      >
        <AccessPointUrl
          label={t(($) => $['mcp.server.url'], { ns: 'tools' })}
          value={serverUrl}
          enabled={activated}
          copyDisabled={!serverPublished || regenerating}
          loading={loading}
          unavailable={unavailable}
          unavailableLabel={t(($) => $['health.ENVIRONMENT_STATUS_FAILED'], {
            ns: 'deployments',
          })}
          showRegenerate
          regenerateLabel={t(($) => $['overview.appInfo.regenerate'], {
            ns: 'appOverview',
          })}
          regenerateDisabled={!canManageAccessPoint || !serverPublished}
          regenerating={regenerating}
          onRegenerate={() => setRegenerationAppId(appInfo.id)}
        />
      </AccessPointCard>

      {showServerModal && (
        <MCPServerModal
          show
          appID={appInfo.id}
          data={serverPublished ? detail : undefined}
          latestParams={latestParams}
          onHide={() => setShowServerModal(false)}
          appInfo={appInfo}
        />
      )}

      <AlertDialog
        open={regenerationAppId === appInfo.id}
        onOpenChange={(open) => !open && setRegenerationAppId(null)}
      >
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
              {t(($) => $[regenerating ? 'operation.close' : 'operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton loading={regenerating} onClick={handleRegenerate}>
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
