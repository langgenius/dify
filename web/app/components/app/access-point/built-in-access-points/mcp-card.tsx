'use client'

import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AccessPointCard } from '@/app/components/base/access-point/card'
import { AccessPointUrl } from '@/app/components/base/access-point/url'
import MCPServerModal from '@/app/components/tools/mcp/mcp-server-modal'
import { selectMCPServerDetail } from '@/app/components/tools/utils/query-select'
import { BlockEnum } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
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
  const [showRegenerate, setShowRegenerate] = useState(false)
  const basicConfig = appInfo.model_config
  const basicAppInputForm = basicConfig?.user_input_form
  const queryClient = useQueryClient()
  const serverDetailQueryOptions = consoleQuery.apps.byAppId.server.get.queryOptions({
    input: { params: { app_id: appInfo.id } },
    enabled: Boolean(appInfo.id),
    select: selectMCPServerDetail,
  })
  const { data: detail, isPending: serverDetailLoading } = useQuery(serverDetailQueryOptions)
  const invalidateServerDetail = () =>
    queryClient.invalidateQueries({ queryKey: serverDetailQueryOptions.queryKey })
  const updateServerMutation = useMutation(
    consoleQuery.apps.byAppId.server.put.mutationOptions({
      scope: {
        id: `app-mcp-toggle:${appInfo.id}`,
      },
      onSuccess: () => invalidateServerDetail(),
      onError: () => {
        toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
      },
    }),
  )
  const { mutateAsync: refreshServerCode, isPending: regenerating } = useMutation(
    consoleQuery.apps.byAppId.server.refresh.post.mutationOptions(),
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

  const handleRegenerate = async () => {
    if (!canManageAccessPoint || !detail?.id) return
    await refreshServerCode({ params: { app_id: appInfo.id } })
    invalidateServerDetail()
    setShowRegenerate(false)
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
          copyDisabled={!serverPublished}
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
          onRegenerate={() => setShowRegenerate(true)}
        />
      </AccessPointCard>

      {showServerModal && (
        <MCPServerModal
          show
          appID={appInfo.id}
          data={serverPublished ? detail : undefined}
          latestParams={latestParams}
          onHide={() => {
            setShowServerModal(false)
            invalidateServerDetail()
          }}
          appInfo={appInfo}
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
            <AlertDialogConfirmButton onClick={() => void handleRegenerate()}>
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
