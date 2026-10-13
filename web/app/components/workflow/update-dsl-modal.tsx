'use client'

import type { AppDetailWithSite, Import } from '@dify/contracts/api/console/apps/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useMutation } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import DSLImportWarningDescription from '@/app/components/app/create-from-dsl-modal/dsl-import-warning-description'
import { Uploader } from '@/app/components/app/create-from-dsl-modal/uploader'
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

type UpdateDSLDialogProps = {
  appId: string
  appMode: AppDetailWithSite['mode']
  open: boolean
  onOpenChange: (open: boolean) => void
  onBackup: () => void
  onImport?: () => void
}

export function UpdateDSLDialog({
  appId,
  appMode,
  open,
  onOpenChange,
  onBackup,
  onImport,
}: UpdateDSLDialogProps) {
  const { t } = useTranslation(['workflow', 'app', 'common'])
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
      onOpenChange(false)
    },
    [handleCheckPluginDependencies, handleWorkflowUpdate, onOpenChange, onImport, t],
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
      if (file.name.toLowerCase().endsWith('.ifpkg'))
        return requestImport({ body: { file, app_id: appId } })

      const content = await file.text()
      if (!content || !validateDSLContent(content, appMode)) {
        toast.error(t(($) => $['common.importFailure'], { ns: 'workflow' }))
        return
      }
      return requestImport({
        body: {
          mode: DSLImportMode.YAML_CONTENT,
          yaml_content: content,
          app_id: appId,
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
  const isImporting = importMutation.isPending || confirmImportMutation.isPending
  const importFile = async (file: File) => {
    if (isImporting) return
    try {
      return await importMutation.mutateAsync(file)
    } catch {
      // The mutation's error callback owns feedback.
    }
  }
  const confirmImport = (importId: string) => {
    if (!isImporting) confirmImportMutation.mutate({ params: { import_id: importId } })
  }
  const close = () => {
    if (!isImporting) onOpenChange(false)
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (isImporting) details.cancel()
        else onOpenChange(nextOpen)
      }}
    >
      <DialogContent className="w-full max-w-120! overflow-y-auto rounded-2xl border-none p-6 text-left align-middle">
        <ImportSession
          open={open}
          isImporting={isImporting}
          importFile={importFile}
          confirmImport={confirmImport}
          onClose={close}
          onBackup={onBackup}
        />
      </DialogContent>
    </Dialog>
  )
}

type ImportSessionProps = {
  open: boolean
  isImporting: boolean
  importFile: (file: File) => Promise<Import | undefined>
  confirmImport: (importId: string) => void
  onClose: () => void
  onBackup: () => void
}

function ImportSession({
  open,
  isImporting,
  importFile,
  confirmImport,
  onClose,
  onBackup,
}: ImportSessionProps) {
  const { t } = useTranslation(['workflow', 'app', 'common'])
  const [currentFile, setCurrentFile] = useState<File>()
  const [pendingImport, setPendingImport] = useState<Import>()
  const handleImport = async () => {
    if (isImporting || !currentFile) return
    const response = await importFile(currentFile)
    if (response?.status === DSLImportStatus.PENDING) setPendingImport(response)
  }
  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void handleImport()
        }}
      >
        <div className="mb-3 flex items-center justify-between">
          <DialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $.importApp, { ns: 'app' })}
          </DialogTitle>
          <DialogClose
            disabled={isImporting}
            render={
              <IconButton
                aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                size="sm"
                variant="ghost"
              >
                <span aria-hidden className="i-ri-close-line size-4.5" />
              </IconButton>
            }
          />
        </div>
        <div className="relative mb-2 flex grow gap-0.5 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-2 shadow-xs">
          <div className="pointer-events-none absolute top-0 left-0 size-full bg-toast-warning-bg opacity-40" />
          <div className="flex items-start justify-center p-1">
            <span
              aria-hidden
              className="i-ri-alert-fill size-4 shrink-0 text-text-warning-secondary"
            />
          </div>
          <div className="flex grow flex-col items-start gap-0.5 py-1">
            <DialogDescription className="system-xs-medium whitespace-pre-line text-text-primary">
              {t(($) => $['common.importDSLTip'], { ns: 'workflow' })}
            </DialogDescription>
            <div className="flex items-start gap-1 self-stretch pt-1 pb-0.5">
              <Button
                size="small"
                variant="secondary"
                className="relative"
                disabled={isImporting}
                onClick={onBackup}
              >
                <span
                  aria-hidden
                  className="i-ri-file-download-line size-3.5 text-components-button-secondary-text"
                />
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
          <DialogClose disabled={isImporting} render={<Button />}>
            {t(($) => $['newApp.Cancel'], { ns: 'app' })}
          </DialogClose>
          <Button
            disabled={!currentFile}
            variant="primary"
            tone="destructive"
            type="submit"
            loading={isImporting}
          >
            {t(($) => $['common.overwriteAndImport'], { ns: 'workflow' })}
          </Button>
        </div>
      </form>
      <Dialog
        open={open && !!pendingImport}
        onOpenChange={(nextOpen, details) => {
          if (isImporting) details.cancel()
          else if (!nextOpen) onClose()
        }}
      >
        <DialogContent className="w-full max-w-120! border-none text-left align-middle">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (pendingImport) confirmImport(pendingImport.id)
            }}
          >
            <div className="flex flex-col items-start gap-2 self-stretch pb-4">
              <DialogTitle className="title-2xl-semi-bold text-text-primary">
                {t(($) => $['newApp.appCreateDSLErrorTitle'], { ns: 'app' })}
              </DialogTitle>
              <DialogDescription
                render={<div />}
                className="flex grow flex-col system-md-regular text-text-secondary"
              >
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
              </DialogDescription>
            </div>
            <div className="flex items-start justify-end gap-2 self-stretch pt-6">
              <DialogClose disabled={isImporting} render={<Button variant="secondary" />}>
                {t(($) => $['newApp.Cancel'], { ns: 'app' })}
              </DialogClose>
              <Button variant="primary" tone="destructive" loading={isImporting} type="submit">
                {t(($) => $['newApp.Confirm'], { ns: 'app' })}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
