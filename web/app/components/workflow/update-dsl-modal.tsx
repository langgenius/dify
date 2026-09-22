'use client'

import type { Import } from '@dify/contracts/api/console/apps/types.gen'
import type { MouseEventHandler } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { RiAlertFill, RiCloseLine, RiFileDownloadLine } from '@remixicon/react'
import { useMutation } from '@tanstack/react-query'
import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import DSLImportWarningDescription from '@/app/components/app/create-from-dsl-modal/dsl-import-warning-description'
import { Uploader } from '@/app/components/app/create-from-dsl-modal/uploader'
import { useStore as useAppStore } from '@/app/components/app/store'
import { getAppTransferErrorMessage } from '@/app/components/app/transfer-error'
import { usePluginDependencies } from '@/app/components/workflow/plugin-dependency/hooks'
import { toast } from '@/app/notifications'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { DSLImportMode, DSLImportStatus } from '@/models/app'
import { consoleQuery } from '@/service/console'
import { fetchWorkflowDraft } from '@/service/workflow'
import { collaborationManager } from './collaboration/core/collaboration-manager'
import { WORKFLOW_DATA_UPDATE } from './constants'
import {
  getImportNotificationPayload,
  isImportCompleted,
  normalizeWorkflowFeatures,
  validateDSLContent,
} from './update-dsl-modal.helpers'
import { initialEdges, initialNodes } from './utils'

type UpdateDSLModalProps = {
  onCancel: () => void
  onBackup: () => void
  onImport?: () => void
}

const UpdateDSLModal = ({ onCancel, onBackup, onImport }: UpdateDSLModalProps) => {
  const { t } = useTranslation(['workflow', 'app', 'common'])
  const appDetail = useAppStore((s) => s.appDetail)
  const [currentFile, setCurrentFile] = useState<File>()
  const { eventEmitter } = useEventEmitterContextContext()
  const { handleCheckPluginDependencies } = usePluginDependencies()

  const handleWorkflowUpdate = useCallback(
    async (app_id: string) => {
      const { graph, features, hash, conversation_variables, environment_variables } =
        await fetchWorkflowDraft(`/apps/${app_id}/workflows/draft`)

      const { nodes, edges, viewport } = graph
      const importedNodes = initialNodes(nodes, edges)
      const importedEdges = initialEdges(edges, nodes)
      if (
        collaborationManager.isConnected() &&
        !collaborationManager.replaceGraphFromCommittedDraft(app_id, importedNodes, importedEdges)
      )
        throw new Error('Collaborative graph is not ready to apply the imported draft.')

      eventEmitter?.emit({
        type: WORKFLOW_DATA_UPDATE,
        payload: {
          nodes: importedNodes,
          edges: importedEdges,
          viewport,
          features: normalizeWorkflowFeatures(features),
          hash,
          conversation_variables: conversation_variables || [],
          environment_variables: environment_variables || [],
        },
      })
    },
    [eventEmitter],
  )

  const handleCompletedImport = useCallback(
    async (status: Import['status'], appId?: string | null, warnings: Import['warnings'] = []) => {
      if (!appId) {
        toast.error(t(($) => $['common.importFailure'], { ns: 'workflow' }))
        return
      }

      const payload = getImportNotificationPayload(status, t)
      toast[payload.type](
        payload.message,
        payload.children
          ? {
              description: (
                <DSLImportWarningDescription warnings={warnings} fallback={payload.children} />
              ),
            }
          : undefined,
      )
      try {
        await handleWorkflowUpdate(appId)
      } catch (error) {
        collaborationManager.emitWorkflowUpdate(appId)
        toast.error(
          t(($) => $.error, { ns: 'common' }),
          {
            description: await getAppTransferErrorMessage(error),
          },
        )
        // Reload the committed graph before the old canvas can resume autosaving.
        window.location.reload()
        return
      }
      collaborationManager.emitWorkflowUpdate(appId)
      onImport?.()
      // Dependency checks own their feedback after the import has already succeeded.
      await handleCheckPluginDependencies(appId)
      onCancel()
    },
    [handleCheckPluginDependencies, handleWorkflowUpdate, onCancel, onImport, t],
  )

  const handleImportResponse = async (response: Import) => {
    if (isImportCompleted(response.status)) {
      await handleCompletedImport(response.status, response.app_id, response.warnings)
    } else if (response.status === DSLImportStatus.FAILED) {
      toast.error(
        t(($) => $['common.importFailure'], { ns: 'workflow' }),
        {
          description: response.error || undefined,
        },
      )
    }
  }

  const notifyImportError = async (error: unknown) => {
    toast.error(
      t(($) => $['common.importFailure'], { ns: 'workflow' }),
      {
        description: await getAppTransferErrorMessage(error),
      },
    )
  }

  const { mutateAsync: requestImport } = useMutation(
    consoleQuery.apps.imports.post.mutationOptions({ context: { silent: true } }),
  )
  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!appDetail) return
      if (file.name.toLowerCase().endsWith('.ifpkg'))
        return requestImport({ body: { file, app_id: appDetail.id } })

      const content = await file.text()
      if (!content || !validateDSLContent(content, appDetail.mode)) {
        toast.error(t(($) => $['common.importFailure'], { ns: 'workflow' }))
        return
      }
      return requestImport({
        body: {
          mode: DSLImportMode.YAML_CONTENT,
          yaml_content: content,
          app_id: appDetail.id,
        },
      })
    },
    onError: notifyImportError,
    onSettled: async (response) => {
      if (response) await handleImportResponse(response)
    },
  })
  const confirmImportMutation = useMutation(
    consoleQuery.apps.imports.byImportId.confirm.post.mutationOptions({
      context: { silent: true },
      onError: (error) => notifyImportError(error),
      onSettled: async (response) => {
        if (response) await handleImportResponse(response)
      },
    }),
  )
  const pendingImport = importMutation.data?.status === 'pending' ? importMutation.data : undefined
  const isImporting = importMutation.isPending || confirmImportMutation.isPending

  const handleImport: MouseEventHandler = () => {
    if (isImporting || !currentFile || !appDetail) return
    importMutation.mutate(currentFile)
  }

  const onUpdateDSLConfirm: MouseEventHandler = () => {
    if (!pendingImport || isImporting) return

    confirmImportMutation.mutate({
      params: { import_id: pendingImport.id },
    })
  }

  return (
    <>
      <Dialog
        open={!pendingImport}
        onOpenChange={(open) => {
          if (!open && !isImporting) onCancel()
        }}
      >
        <DialogContent className="w-full max-w-120! overflow-hidden! rounded-2xl border-none p-6 text-left align-middle">
          <div className="mb-3 flex items-center justify-between">
            <div className="title-2xl-semi-bold text-text-primary">
              {t(($) => $.importApp, { ns: 'app' })}
            </div>
            <button
              type="button"
              className="flex h-5.5 w-5.5 cursor-pointer items-center justify-center border-none bg-transparent p-0 focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              disabled={isImporting}
              onClick={onCancel}
            >
              <RiCloseLine className="h-4.5 w-4.5 text-text-tertiary" aria-hidden="true" />
            </button>
          </div>
          <div className="relative mb-2 flex grow gap-0.5 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-2 shadow-xs">
            <div className="pointer-events-none absolute top-0 left-0 size-full bg-toast-warning-bg opacity-40" />
            <div className="flex items-start justify-center p-1">
              <RiAlertFill className="size-4 shrink-0 text-text-warning-secondary" />
            </div>
            <div className="flex grow flex-col items-start gap-0.5 py-1">
              <div className="system-xs-medium whitespace-pre-line text-text-primary">
                {t(($) => $['common.importDSLTip'], { ns: 'workflow' })}
              </div>
              <div className="flex items-start gap-1 self-stretch pt-1 pb-0.5">
                <Button
                  size="small"
                  variant="secondary"
                  className="relative"
                  disabled={isImporting}
                  onClick={onBackup}
                >
                  <RiFileDownloadLine className="size-3.5 text-components-button-secondary-text" />
                  <div className="flex items-center justify-center gap-1">
                    {t(($) => $['common.backupCurrentDraft'], { ns: 'workflow' })}
                  </div>
                </Button>
              </div>
            </div>
          </div>
          <div>
            <div className="pt-2 system-md-semibold text-text-primary">
              {t(($) => $.chooseAppFile, { ns: 'app' })}
            </div>
            <div className="flex w-full flex-col items-start justify-center gap-4 self-stretch py-4">
              <Uploader
                importType="app"
                disabled={isImporting}
                file={currentFile}
                updateFile={setCurrentFile}
                className="mt-0! w-full"
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 self-stretch pt-5">
            <Button disabled={isImporting} onClick={onCancel}>
              {t(($) => $['newApp.Cancel'], { ns: 'app' })}
            </Button>
            <Button
              disabled={isImporting || !currentFile || !appDetail}
              variant="primary"
              tone="destructive"
              onClick={handleImport}
              loading={importMutation.isPending}
            >
              {t(($) => $['common.overwriteAndImport'], { ns: 'workflow' })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!pendingImport}
        onOpenChange={(open) => {
          if (!open && !isImporting) onCancel()
        }}
      >
        <DialogContent className="w-full max-w-120! overflow-hidden! border-none text-left align-middle">
          <div className="flex flex-col items-start gap-2 self-stretch pb-4">
            <div className="title-2xl-semi-bold text-text-primary">
              {t(($) => $['newApp.appCreateDSLErrorTitle'], { ns: 'app' })}
            </div>
            <div className="flex grow flex-col system-md-regular text-text-secondary">
              <div>{t(($) => $['newApp.appCreateDSLErrorPart1'], { ns: 'app' })}</div>
              <div>{t(($) => $['newApp.appCreateDSLErrorPart2'], { ns: 'app' })}</div>
              <br />
              <div>
                {t(($) => $['newApp.appCreateDSLErrorPart3'], { ns: 'app' })}
                <span className="system-md-medium">{pendingImport?.imported_dsl_version}</span>
              </div>
              <div>
                {t(($) => $['newApp.appCreateDSLErrorPart4'], { ns: 'app' })}
                <span className="system-md-medium">{pendingImport?.current_dsl_version}</span>
              </div>
            </div>
          </div>
          <div className="flex items-start justify-end gap-2 self-stretch pt-6">
            <Button variant="secondary" disabled={isImporting} onClick={onCancel}>
              {t(($) => $['newApp.Cancel'], { ns: 'app' })}
            </Button>
            <Button
              variant="primary"
              tone="destructive"
              disabled={isImporting}
              loading={confirmImportMutation.isPending}
              onClick={onUpdateDSLConfirm}
            >
              {t(($) => $['newApp.Confirm'], { ns: 'app' })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default memo(UpdateDSLModal)
