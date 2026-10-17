'use client'

import type { AppDetailWithSite, Import } from '@dify/contracts/api/console/apps/types.gen'
import type { DialogActions, DialogProps } from '@langgenius/dify-ui/dialog'
import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { RiAlertFill, RiFileDownloadLine } from '@remixicon/react'
import { useMutation } from '@tanstack/react-query'
import { memo, useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import DSLImportWarningDescription from '@/app/components/app/create-from-dsl-modal/dsl-import-warning-description'
import { Uploader } from '@/app/components/app/create-from-dsl-modal/uploader'
import { usePluginDependencies } from '@/app/components/workflow/plugin-dependency/hooks'
import { toast } from '@/app/notifications'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { DSLImportMode, DSLImportStatus } from '@/models/app'
import { consoleQuery } from '@/service/console'
import { fetchWorkflowDraft } from '@/service/workflow'
import { getErrorMessage } from '@/utils/error-message'
import { collaborationManager } from './collaboration/core/collaboration-manager'
import { WORKFLOW_DATA_UPDATE } from './constants'
import {
  getImportNotificationPayload,
  isImportCompleted,
  normalizeWorkflowFeatures,
  validateDSLContent,
} from './update-dsl-modal.helpers'
import { initialEdges, initialNodes } from './utils'

type UpdateDSLModalProps = Pick<DialogProps, 'open' | 'onOpenChange'> & {
  children?: ReactNode
  appId: string
  appMode: AppDetailWithSite['mode']
  onBackup: () => void
  onImport?: () => void
}

function UpdateDSLModal({
  open,
  onOpenChange,
  children,
  appId,
  appMode,
  onBackup,
  onImport,
}: UpdateDSLModalProps) {
  const browseButtonRef = useRef<HTMLButtonElement>(null)
  const actionsRef = useRef<DialogActions>(null)
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
            description: getErrorMessage(error),
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
      actionsRef.current?.close()
    },
    [handleCheckPluginDependencies, handleWorkflowUpdate, onImport, t],
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
        description: getErrorMessage(error),
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
  const pendingImport = importMutation.data?.status === 'pending' ? importMutation.data : undefined
  const isImporting = importMutation.isPending || confirmImportMutation.isPending

  const onUpdateDSLConfirm = () => {
    if (!pendingImport || isImporting) return

    confirmImportMutation.mutate({
      params: { import_id: pendingImport.id },
    })
  }

  return (
    <Dialog
      actionsRef={actionsRef}
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && isImporting && details.reason !== 'imperative-action') details.cancel()
        else onOpenChange?.(nextOpen, details)
      }}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) {
          importMutation.reset()
          confirmImportMutation.reset()
        }
      }}
    >
      <DialogContent initialFocus={browseButtonRef} className="w-120">
        <ImportForm
          browseButtonRef={browseButtonRef}
          isImporting={isImporting}
          onBackup={onBackup}
          onSubmit={(file) => {
            if (!isImporting) importMutation.mutate(file)
          }}
        />
        {children}
        <Dialog
          open={!!pendingImport}
          onOpenChange={(open, details) => {
            if (!open && isImporting) details.cancel()
            else if (!open) importMutation.reset()
          }}
        >
          <DialogContent className="w-120">
            <form
              className="contents"
              onSubmit={(event) => {
                event.preventDefault()
                onUpdateDSLConfirm()
              }}
            >
              <DialogHeader>
                <DialogTitle>
                  {t(($) => $['newApp.appCreateDSLErrorTitle'], { ns: 'app' })}
                </DialogTitle>
              </DialogHeader>
              <DialogBody>
                <div className="flex flex-col system-md-regular text-text-secondary">
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
              </DialogBody>
              <DialogFooter>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isImporting}
                  onClick={() => importMutation.reset()}
                >
                  {t(($) => $['newApp.Cancel'], { ns: 'app' })}
                </Button>
                <Button
                  variant="primary"
                  tone="destructive"
                  disabled={isImporting}
                  loading={confirmImportMutation.isPending}
                  type="submit"
                >
                  {t(($) => $['newApp.Confirm'], { ns: 'app' })}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}

function ImportForm({
  browseButtonRef,
  isImporting,
  onBackup,
  onSubmit,
}: {
  browseButtonRef: React.RefObject<HTMLButtonElement | null>
  isImporting: boolean
  onBackup: UpdateDSLModalProps['onBackup']
  onSubmit: (file: File) => void
}) {
  const { t } = useTranslation(['workflow', 'app', 'common'])
  const [currentFile, setCurrentFile] = useState<File>()
  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault()
        if (event.target === event.currentTarget && !isImporting && currentFile)
          onSubmit(currentFile)
      }}
    >
      <DialogHeader>
        <DialogTitle>{t(($) => $.importApp, { ns: 'app' })}</DialogTitle>
        <DialogCloseButton
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
          disabled={isImporting}
        />
      </DialogHeader>
      <DialogBody>
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
                type="button"
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
              browseButtonRef={browseButtonRef}
              importType="app"
              disabled={isImporting}
              file={currentFile}
              updateFile={setCurrentFile}
              className="mt-0! w-full"
            />
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <DialogClose disabled={isImporting} render={<Button type="button" />}>
          {t(($) => $['newApp.Cancel'], { ns: 'app' })}
        </DialogClose>
        <Button
          disabled={isImporting || !currentFile}
          variant="primary"
          tone="destructive"
          type="submit"
          loading={isImporting}
        >
          {t(($) => $['common.overwriteAndImport'], { ns: 'workflow' })}
        </Button>
      </DialogFooter>
    </form>
  )
}

export default memo(UpdateDSLModal)
