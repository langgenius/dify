'use client'

import type { AccessPointAppInfo, PublishedWorkflow } from '../shared/utils'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import MCPServerModal from '@/app/components/tools/mcp/mcp-server-modal'
import { BlockEnum } from '@/app/components/workflow/types'
import {
  useInvalidateMCPServerDetail,
  useMCPServerDetail,
  useRefreshMCPServerCode,
  useUpdateMCPServer,
} from '@/service/use-tools'
import { AppModeEnum } from '@/types/app'
import { AccessPointCard } from '../shared/access-point-card'
import { AccessPointUrl } from '../shared/access-point-url'
import { getPublishedWorkflowNodes, isAdvancedApp } from '../shared/utils'

type MCPAccessPointCardProps = {
  appInfo: AccessPointAppInfo
  canEdit: boolean
  highlighted?: boolean
  triggerModeDisabled: boolean
  workflow: PublishedWorkflow
  workflowLoading: boolean
}

export function MCPAccessPointCard({
  appInfo,
  canEdit,
  highlighted,
  triggerModeDisabled,
  workflow,
  workflowLoading,
}: MCPAccessPointCardProps) {
  const { t } = useTranslation()
  const advancedApp = isAdvancedApp(appInfo)
  const basicApp = !advancedApp
  const workflowApp = appInfo.mode === AppModeEnum.WORKFLOW
  const [showServerModal, setShowServerModal] = useState(false)
  const [showRegenerate, setShowRegenerate] = useState(false)
  const [pendingStatus, setPendingStatus] = useState<boolean | null>(null)
  const basicConfig = appInfo.model_config
  const basicAppInputForm = basicConfig?.user_input_form
  const { data: detail, isPending: serverDetailLoading } = useMCPServerDetail(
    appInfo.id,
    Boolean(appInfo.id),
  )
  const { mutateAsync: updateServer, isPending: statusUpdating } = useUpdateMCPServer()
  const { mutateAsync: refreshServerCode, isPending: regenerating } = useRefreshMCPServerCode()
  const invalidateServerDetail = useInvalidateMCPServerDetail()

  const serverPublished = Boolean(detail?.id)
  const serverActivated = detail?.status === 'active'
  const activated = pendingStatus ?? serverActivated
  const serverUrl = serverPublished
    ? `${appInfo.api_base_url.replace(/\/v1$/, '')}/mcp/server/${detail?.server_code}/mcp`
    : '***********'
  const workflowNodes = getPublishedWorkflowNodes(workflow)
  const missingStartNode =
    workflowApp && !workflowNodes.some((node) => node.data.type === BlockEnum.Start)
  const appUnpublished = advancedApp ? !workflow?.graph : !basicConfig?.updated_at
  const loading = serverDetailLoading || (advancedApp && workflowLoading)
  const unavailable = !loading && (appUnpublished || missingStartNode || triggerModeDisabled)

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

  const handleStatusChange = async (enabled: boolean) => {
    if (!canEdit || loading || unavailable) return
    if (enabled && !serverPublished) {
      setShowServerModal(true)
      return
    }

    setPendingStatus(enabled)
    try {
      await updateServer({
        appID: appInfo.id,
        id: detail?.id || '',
        description: detail?.description || '',
        parameters: detail?.parameters || {},
        status: enabled ? 'active' : 'inactive',
      })
      invalidateServerDetail(appInfo.id)
    } finally {
      setPendingStatus(null)
    }
  }

  const handleRegenerate = async () => {
    if (!canEdit || !detail?.id) return
    await refreshServerCode(appInfo.id)
    invalidateServerDetail(appInfo.id)
    setShowRegenerate(false)
  }

  const status = loading
    ? 'loading'
    : unavailable
      ? 'unavailable'
      : activated
        ? 'inService'
        : 'disabled'

  return (
    <>
      <AccessPointCard
        title={t(($) => $['mcp.server.title'], { ns: 'tools' })}
        description={t(($) => $['studio.accessPoint.mcpDescription'], {
          ns: 'deployments',
        })}
        icon="i-custom-vender-integrations-mcp"
        status={status}
        highlighted={highlighted}
        busy={statusUpdating}
        switchDisabled={!canEdit}
        switchLabel={t(($) => $['mcp.server.title'], { ns: 'tools' })}
        onEnabledChange={loading || unavailable ? undefined : handleStatusChange}
        actions={
          <Button
            variant="secondary"
            disabled={loading || unavailable || !canEdit}
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
          regenerateDisabled={!canEdit || !serverPublished}
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
            setPendingStatus(null)
            invalidateServerDetail(appInfo.id)
          }}
          appInfo={appInfo}
        />
      )}

      <AlertDialog open={showRegenerate} onOpenChange={(open) => !open && setShowRegenerate(false)}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
              {t(($) => $['overview.appInfo.regenerate'], { ns: 'appOverview' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="system-md-regular text-text-tertiary">
              {t(($) => $['mcp.server.reGen'], { ns: 'tools' })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton onClick={() => void handleRegenerate()}>
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
