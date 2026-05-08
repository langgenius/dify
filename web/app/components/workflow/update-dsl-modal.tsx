'use client'

import type { MouseEventHandler } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { toast } from '@langgenius/dify-ui/toast'
import {
  RiAlertFill,
  RiCloseLine,
  RiFileDownloadLine,
} from '@remixicon/react'
import {
  memo,
  useCallback,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Uploader from '@/app/components/app/create-from-dsl-modal/uploader'
import { useStore as useAppStore } from '@/app/components/app/store'
import { usePluginDependencies } from '@/app/components/workflow/plugin-dependency/hooks'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import {
  DSLImportMode,
  DSLImportStatus,
} from '@/models/app'
import {
  importDSL,
  importDSLConfirm,
} from '@/service/apps'
import { fetchWorkflowDraft } from '@/service/workflow'
import { collaborationManager } from './collaboration/core/collaboration-manager'
import { WORKFLOW_DATA_UPDATE } from './constants'
import {
  getImportNotificationPayload,
  isImportCompleted,
  normalizeWorkflowFeatures,
  validateDSLContent,
} from './update-dsl-modal.helpers'
import {
  initialEdges,
  initialNodes,
} from './utils'

type UpdateDSLModalProps = {
  onCancel: () => void
  onBackup: () => void
  onImport?: () => void
}

const UpdateDSLModal = ({
  onCancel,
  onBackup,
  onImport,
}: UpdateDSLModalProps) => {
  const { t } = useTranslation()
  const appDetail = useAppStore(s => s.appDetail)
  const [currentFile, setDSLFile] = useState<File>()
  const [fileContent, setFileContent] = useState<string>()
  const [loading, setLoading] = useState(false)
  const { eventEmitter } = useEventEmitterContextContext()
  const [show, setShow] = useState(true)
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [versions, setVersions] = useState<{ importedVersion: string, systemVersion: string }>()
  const [importId, setImportId] = useState<string>()
  const { handleCheckPluginDependencies } = usePluginDependencies()

  const readFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = function (event) {
      const content = event.target?.result
      setFileContent(content as string)
    }
    reader.readAsText(file)
  }

  const handleFile = (file?: File) => {
    setDSLFile(file)
    if (file)
      readFile(file)
    if (!file)
      setFileContent('')
  }

  const handleWorkflowUpdate = useCallback(async (app_id: string) => {
    const {
      graph,
      features,
      hash,
      conversation_variables,
      environment_variables,
    } = await fetchWorkflowDraft(`/apps/${app_id}/workflows/draft`)

    const { nodes, edges, viewport } = graph
    eventEmitter?.emit({
      type: WORKFLOW_DATA_UPDATE,
      payload: {
        nodes: initialNodes(nodes, edges),
        edges: initialEdges(edges, nodes),
        viewport,
        features: normalizeWorkflowFeatures(features),
        hash,
        conversation_variables: conversation_variables || [],
        environment_variables: environment_variables || [],
      },
    } as any)
  }, [eventEmitter])

  const isCreatingRef = useRef(false)
  const handleCompletedImport = useCallback(async (status: DSLImportStatus, appId?: string) => {
    if (!appId) {
      toast.error(t('common.importFailure', { ns: 'workflow' }))
      return
    }

    await handleWorkflowUpdate(appId)
    collaborationManager.emitWorkflowUpdate(appId)
    onImport?.()
    const payload = getImportNotificationPayload(status, t)
    toast[payload.type](payload.message, payload.children ? { description: payload.children } : undefined)
    await handleCheckPluginDependencies(appId)
    setLoading(false)
    onCancel()
  }, [handleCheckPluginDependencies, handleWorkflowUpdate, onCancel, onImport, t])

  const handlePendingImport = useCallback((id: string, importedVersion?: string | null, currentVersion?: string | null) => {
    setShow(false)
    setTimeout(() => {
      setShowErrorModal(true)
    }, 300)
    setVersions({
      importedVersion: importedVersion ?? '',
      systemVersion: currentVersion ?? '',
    })
    setImportId(id)
  }, [])

  const handleImport: MouseEventHandler = useCallback(async () => {
    if (isCreatingRef.current)
      return
    isCreatingRef.current = true
    if (!currentFile) {
      isCreatingRef.current = false
      return
    }
    try {
      if (appDetail && fileContent && validateDSLContent(fileContent, appDetail.mode)) {
        setLoading(true)
        const response = await importDSL({ mode: DSLImportMode.YAML_CONTENT, yaml_content: fileContent, app_id: appDetail.id })
        const { id, status, app_id, imported_dsl_version, current_dsl_version } = response

        if (isImportCompleted(status)) {
          await handleCompletedImport(status, app_id)
        }
        else if (status === DSLImportStatus.PENDING) {
          handlePendingImport(id, imported_dsl_version, current_dsl_version)
        }
        else {
          setLoading(false)
          toast.error(t('common.importFailure', { ns: 'workflow' }))
        }
      }
      else if (fileContent) {
        toast.error(t('common.importFailure', { ns: 'workflow' }))
      }
    }
    // eslint-disable-next-line unused-imports/no-unused-vars
    catch (e) {
      setLoading(false)
      toast.error(t('common.importFailure', { ns: 'workflow' }))
    }
    isCreatingRef.current = false
  }, [currentFile, fileContent, t, appDetail, handleCompletedImport, handlePendingImport])

  const onUpdateDSLConfirm: MouseEventHandler = async () => {
    try {
      if (!importId)
        return
      const response = await importDSLConfirm({
        import_id: importId,
      })

      const { status, app_id } = response

      if (isImportCompleted(status)) {
        await handleCompletedImport(status, app_id)
      }
      else if (status === DSLImportStatus.FAILED) {
        setLoading(false)
        toast.error(t('common.importFailure', { ns: 'workflow' }))
      }
    }
    // eslint-disable-next-line unused-imports/no-unused-vars
    catch (e) {
      setLoading(false)
      toast.error(t('common.importFailure', { ns: 'workflow' }))
    }
  }

  return (
    <>
      <Dialog
        open={show}
        onOpenChange={(open) => {
          if (!open)
            onCancel()
        }}
      >
        <DialogContent className="w-full max-w-[480px]! overflow-hidden! rounded-2xl border-none p-6 text-left align-middle">

          <div className="mb-3 flex items-center justify-between">
            <div className="title-2xl-semi-bold text-text-primary">{t('importApp', { ns: 'app' })}</div>
            <div className="flex h-[22px] w-[22px] cursor-pointer items-center justify-center" onClick={onCancel}>
              <RiCloseLine className="h-[18px] w-[18px] text-text-tertiary" />
            </div>
          </div>
          <div className="relative mb-2 flex grow gap-0.5 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-2 shadow-xs">
            <div className="absolute top-0 left-0 h-full w-full bg-toast-warning-bg opacity-40" />
            <div className="flex items-start justify-center p-1">
              <RiAlertFill className="h-4 w-4 shrink-0 text-text-warning-secondary" />
            </div>
            <div className="flex grow flex-col items-start gap-0.5 py-1">
              <div className="system-xs-medium whitespace-pre-line text-text-primary">{t('common.importDSLTip', { ns: 'workflow' })}</div>
              <div className="flex items-start gap-1 self-stretch pt-1 pb-0.5">
                <Button
                  size="small"
                  variant="secondary"
                  className="z-1000"
                  onClick={onBackup}
                >
                  <RiFileDownloadLine className="h-3.5 w-3.5 text-components-button-secondary-text" />
                  <div className="flex items-center justify-center gap-1 px-[3px]">
                    {t('common.backupCurrentDraft', { ns: 'workflow' })}
                  </div>
                </Button>
              </div>
            </div>
          </div>
          <div>
            <div className="pt-2 system-md-semibold text-text-primary">
              {t('common.chooseDSL', { ns: 'workflow' })}
            </div>
            <div className="flex w-full flex-col items-start justify-center gap-4 self-stretch py-4">
              <Uploader
                file={currentFile}
                updateFile={handleFile}
                className="mt-0! w-full"
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 self-stretch pt-5">
            <Button onClick={onCancel}>{t('newApp.Cancel', { ns: 'app' })}</Button>
            <Button
              disabled={!currentFile || loading}
              variant="primary"
              tone="destructive"
              onClick={handleImport}
              loading={loading}
            >
              {t('common.overwriteAndImport', { ns: 'workflow' })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={showErrorModal}
        onOpenChange={(open) => {
          if (!open)
            setShowErrorModal(false)
        }}
      >
        <DialogContent className="w-full max-w-[480px]! overflow-hidden! border-none text-left align-middle">

          <div className="flex flex-col items-start gap-2 self-stretch pb-4">
            <div className="title-2xl-semi-bold text-text-primary">{t('newApp.appCreateDSLErrorTitle', { ns: 'app' })}</div>
            <div className="flex grow flex-col system-md-regular text-text-secondary">
              <div>{t('newApp.appCreateDSLErrorPart1', { ns: 'app' })}</div>
              <div>{t('newApp.appCreateDSLErrorPart2', { ns: 'app' })}</div>
              <br />
              <div>
                {t('newApp.appCreateDSLErrorPart3', { ns: 'app' })}
                <span className="system-md-medium">{versions?.importedVersion}</span>
              </div>
              <div>
                {t('newApp.appCreateDSLErrorPart4', { ns: 'app' })}
                <span className="system-md-medium">{versions?.systemVersion}</span>
              </div>
            </div>
          </div>
          <div className="flex items-start justify-end gap-2 self-stretch pt-6">
            <Button variant="secondary" onClick={() => setShowErrorModal(false)}>{t('newApp.Cancel', { ns: 'app' })}</Button>
            <Button variant="primary" tone="destructive" onClick={onUpdateDSLConfirm}>{t('newApp.Confirm', { ns: 'app' })}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default memo(UpdateDSLModal)
