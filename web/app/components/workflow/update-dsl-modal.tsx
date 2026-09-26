'use client'

import type { Import } from '@dify/contracts/api/console/apps/types.gen'
import type { MouseEventHandler } from 'react'
import type {
  WorkflowDataUpdateEvent,
  WorkflowDataUpdatePayload,
} from './workflow-data-update-event'
import type { Dependency } from '@/app/components/plugins/types'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { RiAlertFill, RiCloseLine, RiFileDownloadLine } from '@remixicon/react'
import { useMutation } from '@tanstack/react-query'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStoreApi } from 'reactflow'
import DSLImportWarningDescription from '@/app/components/app/create-from-dsl-modal/dsl-import-warning-description'
import { Uploader } from '@/app/components/app/create-from-dsl-modal/uploader'
import { useStore as useAppStore } from '@/app/components/app/store'
import { getAppTransferErrorMessage } from '@/app/components/app/transfer-error'
import { useStore as usePluginDependenciesStore } from '@/app/components/workflow/plugin-dependency/store'
import { toast } from '@/app/notifications'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { DSLImportMode, DSLImportStatus } from '@/models/app'
import { consoleQuery } from '@/service/console'
import { fetchWorkflowDraft } from '@/service/workflow'
import { collaborationManager } from './collaboration/core/collaboration-manager'
import { WORKFLOW_DATA_UPDATE } from './constants'
import { useStore, useWorkflowStore } from './store'
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

type PreparedImport = {
  response: Import
  workflowData?: WorkflowDataUpdatePayload
  refreshError?: string
}

const UpdateDSLModal = ({ onCancel, onBackup, onImport }: UpdateDSLModalProps) => {
  const { t } = useTranslation(['workflow', 'app', 'common'])
  const appId = useStore((state) => state.appId)
  const appMode = useAppStore((state) => state.appDetail?.mode)
  const workflowStore = useWorkflowStore()
  const reactFlowStore = useStoreApi()
  const [currentFile, setCurrentFile] = useState<File>()
  const { eventEmitter } = useEventEmitterContextContext()
  const { mutateAsync: requestImport } = useMutation(
    consoleQuery.apps.imports.post.mutationOptions({ context: { silent: true } }),
  )
  const { mutateAsync: requestConfirmation } = useMutation(
    consoleQuery.apps.imports.byImportId.confirm.post.mutationOptions({
      context: { silent: true },
    }),
  )
  const { mutateAsync: requestDependencies } = useMutation(
    consoleQuery.apps.imports.byAppId.checkDependencies.get.mutationOptions({
      context: { silent: true },
    }),
  )

  const prepareImport = async (response: Import): Promise<PreparedImport> => {
    if (!isImportCompleted(response.status) || !response.app_id) return { response }

    let workflowData: WorkflowDataUpdatePayload
    try {
      const { graph, features, hash, conversation_variables, environment_variables } =
        await fetchWorkflowDraft(`/apps/${response.app_id}/workflows/draft`)
      const { nodes, edges, viewport } = graph
      workflowData = {
        nodes: initialNodes(nodes, edges),
        edges: initialEdges(edges, nodes),
        viewport,
        features: normalizeWorkflowFeatures(features),
        hash,
        conversation_variables: conversation_variables || [],
        environment_variables: environment_variables || [],
      }
    } catch (error) {
      return { response, refreshError: await getAppTransferErrorMessage(error) }
    }

    return { response, workflowData }
  }

  const dependencyMutation = useMutation({
    mutationFn: async (appId: string): Promise<{ dependencies: Dependency[]; error?: string }> => {
      try {
        const { leaked_dependencies } = await requestDependencies({ params: { app_id: appId } })
        return {
          dependencies: (leaked_dependencies ?? []).map((dependency) => ({
            ...dependency,
            value: { ...dependency.value, version: dependency.value.version ?? undefined },
          })),
        }
      } catch (error) {
        return { dependencies: [], error: await getAppTransferErrorMessage(error) }
      }
    },
  })

  const handleImportResponse = (result: PreparedImport | undefined) => {
    if (!result) return
    const { response, workflowData, refreshError } = result
    if (isImportCompleted(response.status)) {
      if (!response.app_id) {
        toast.error(t(($) => $['common.importFailure'], { ns: 'workflow' }))
        return
      }

      const notification = getImportNotificationPayload(response.status, t)
      toast[notification.type](
        notification.message,
        notification.children
          ? {
              description: (
                <DSLImportWarningDescription
                  warnings={response.warnings ?? []}
                  fallback={notification.children}
                />
              ),
            }
          : undefined,
      )

      const cannotApplyGraph =
        workflowData &&
        collaborationManager.ownsReactFlowStore(reactFlowStore) &&
        collaborationManager.isConnected() &&
        !collaborationManager.replaceGraphFromCommittedDraft(
          response.app_id,
          reactFlowStore,
          workflowData.nodes,
          workflowData.edges,
        )
      if (refreshError || cannotApplyGraph) {
        collaborationManager.emitWorkflowUpdate(response.app_id)
        toast.error(
          t(($) => $.error, { ns: 'common' }),
          {
            description:
              refreshError || 'Collaborative graph is not ready to apply the imported draft.',
          },
        )
        // Reload the committed graph before this canvas can resume autosaving.
        window.location.reload()
        return
      }

      if (workflowData) {
        eventEmitter?.emit({
          type: WORKFLOW_DATA_UPDATE,
          payload: { ...workflowData, target: workflowStore },
        } satisfies WorkflowDataUpdateEvent)
      }
      collaborationManager.emitWorkflowUpdate(response.app_id)
      onImport?.()
      dependencyMutation.mutate(response.app_id, {
        onSuccess: ({ dependencies, error }) => {
          usePluginDependenciesStore.getState().setDependencies(dependencies)
          if (error)
            toast.error(
              t(($) => $.error, { ns: 'common' }),
              { description: error },
            )
          onCancel()
        },
      })
    } else if (response.status === DSLImportStatus.FAILED) {
      toast.error(
        t(($) => $['common.importFailure'], { ns: 'workflow' }),
        { description: response.error || undefined },
      )
    }
  }

  const notifyImportError = (error: Error) => {
    toast.error(
      t(($) => $['common.importFailure'], { ns: 'workflow' }),
      { description: error.message },
    )
  }

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!appId || !appMode) return
      try {
        if (file.name.toLowerCase().endsWith('.ifpkg'))
          return prepareImport(await requestImport({ body: { file, app_id: appId } }))

        const content = await file.text()
        if (!content || !validateDSLContent(content, appMode))
          throw new Error(t(($) => $['common.importFailure'], { ns: 'workflow' }))

        return prepareImport(
          await requestImport({
            body: {
              mode: DSLImportMode.YAML_CONTENT,
              yaml_content: content,
              app_id: appId,
            },
          }),
        )
      } catch (error) {
        throw new Error(await getAppTransferErrorMessage(error))
      }
    },
  })
  const confirmImportMutation = useMutation({
    mutationFn: async (importId: string) => {
      try {
        return prepareImport(await requestConfirmation({ params: { import_id: importId } }))
      } catch (error) {
        throw new Error(await getAppTransferErrorMessage(error))
      }
    },
  })
  const pendingImport =
    importMutation.data?.response.status === 'pending' ? importMutation.data.response : undefined
  const isImporting =
    importMutation.isPending || confirmImportMutation.isPending || dependencyMutation.isPending

  const handleImport: MouseEventHandler = () => {
    if (isImporting || !currentFile || !appId || !appMode) return
    importMutation.mutate(currentFile, {
      onSuccess: handleImportResponse,
      onError: notifyImportError,
    })
  }

  const onUpdateDSLConfirm: MouseEventHandler = () => {
    if (!pendingImport || isImporting) return
    confirmImportMutation.mutate(pendingImport.id, {
      onSuccess: handleImportResponse,
      onError: notifyImportError,
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
              disabled={isImporting || !currentFile || !appId || !appMode}
              variant="primary"
              tone="destructive"
              onClick={handleImport}
              loading={isImporting}
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
              loading={isImporting}
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
