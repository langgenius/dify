'use client'

import type { MouseEventHandler } from 'react'
import {
  memo,
  useCallback,
  useRef,
  useState,
} from 'react'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import {
  RiAlertFill,
  RiCloseLine,
  RiFileDownloadLine,
} from '@remixicon/react'
import { WORKFLOW_DATA_UPDATE } from '@/app/components/workflow/constants'
import {
  initialEdges,
  initialNodes,
} from '@/app/components/workflow/utils'
import {
  useImportPipelineDSL,
  useImportPipelineDSLConfirm,
} from '@/service/use-pipeline'
import { fetchWorkflowDraft } from '@/service/workflow'
import {
  DSLImportMode,
  DSLImportStatus,
} from '@/models/app'
import Uploader from '@/app/components/app/create-from-dsl-modal/uploader'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'
import { ToastContext } from '@/app/components/base/toast'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { usePluginDependencies } from '@/app/components/workflow/plugin-dependency/hooks'
import { useWorkflowStore } from '@/app/components/workflow/store'

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
  const { notify } = useContext(ToastContext)
  const [currentFile, setDSLFile] = useState<File>()
  const [fileContent, setFileContent] = useState<string>()
  const [loading, setLoading] = useState(false)
  const { eventEmitter } = useEventEmitterContextContext()
  const [show, setShow] = useState(true)
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [versions, setVersions] = useState<{ importedVersion: string; systemVersion: string }>()
  const [importId, setImportId] = useState<string>()
  const { handleCheckPluginDependencies } = usePluginDependencies()
  const { mutateAsync: importDSL } = useImportPipelineDSL()
  const { mutateAsync: importDSLConfirm } = useImportPipelineDSLConfirm()
  const workflowStore = useWorkflowStore()

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

  const handleWorkflowUpdate = useCallback(async (pipelineId: string) => {
    const {
      graph,
      hash,
      rag_pipeline_variables,
    } = await fetchWorkflowDraft(`/rag/pipelines/${pipelineId}/workflows/draft`)

    const { nodes, edges, viewport } = graph

    eventEmitter?.emit({
      type: WORKFLOW_DATA_UPDATE,
      payload: {
        nodes: initialNodes(nodes, edges),
        edges: initialEdges(edges, nodes),
        viewport,
        hash,
        rag_pipeline_variables: rag_pipeline_variables || [],
      },
    } as any)
  }, [eventEmitter])

  const isCreatingRef = useRef(false)
  const handleImport: MouseEventHandler = useCallback(async () => {
    const { pipelineId } = workflowStore.getState()
    if (isCreatingRef.current)
      return
    isCreatingRef.current = true
    if (!currentFile)
      return
    try {
      if (pipelineId && fileContent) {
        setLoading(true)
        const response = await importDSL({ mode: DSLImportMode.YAML_CONTENT, yaml_content: fileContent, pipeline_id: pipelineId })
        const { id, status, pipeline_id, imported_dsl_version, current_dsl_version } = response

        if (status === DSLImportStatus.COMPLETED || status === DSLImportStatus.COMPLETED_WITH_WARNINGS) {
          if (!pipeline_id) {
            notify({ type: 'error', message: t('workflow.common.importFailure') })
            return
          }
          handleWorkflowUpdate(pipeline_id)
          if (onImport)
            onImport()
          notify({
            type: status === DSLImportStatus.COMPLETED ? 'success' : 'warning',
            message: t(status === DSLImportStatus.COMPLETED ? 'workflow.common.importSuccess' : 'workflow.common.importWarning'),
            children: status === DSLImportStatus.COMPLETED_WITH_WARNINGS && t('workflow.common.importWarningDetails'),
          })
          await handleCheckPluginDependencies(pipeline_id, true)
          setLoading(false)
          onCancel()
        }
        else if (status === DSLImportStatus.PENDING) {
          setShow(false)
          setTimeout(() => {
            setShowErrorModal(true)
          }, 300)
          setVersions({
            importedVersion: imported_dsl_version ?? '',
            systemVersion: current_dsl_version ?? '',
          })
          setImportId(id)
        }
        else {
          setLoading(false)
          notify({ type: 'error', message: t('workflow.common.importFailure') })
        }
      }
    }
    // eslint-disable-next-line unused-imports/no-unused-vars
    catch (e) {
      setLoading(false)
      notify({ type: 'error', message: t('workflow.common.importFailure') })
    }
    isCreatingRef.current = false
  }, [currentFile, fileContent, onCancel, notify, t, onImport, handleWorkflowUpdate, handleCheckPluginDependencies, workflowStore, importDSL])

  const onUpdateDSLConfirm: MouseEventHandler = async () => {
    try {
      if (!importId)
        return
      const response = await importDSLConfirm(importId)

      const { status, pipeline_id } = response

      if (status === DSLImportStatus.COMPLETED) {
        if (!pipeline_id) {
          notify({ type: 'error', message: t('workflow.common.importFailure') })
          return
        }
        handleWorkflowUpdate(pipeline_id)
        await handleCheckPluginDependencies(pipeline_id, true)
        if (onImport)
          onImport()
        notify({ type: 'success', message: t('workflow.common.importSuccess') })
        setLoading(false)
        onCancel()
      }
      else if (status === DSLImportStatus.FAILED) {
        setLoading(false)
        notify({ type: 'error', message: t('workflow.common.importFailure') })
      }
    }
    // eslint-disable-next-line unused-imports/no-unused-vars
    catch (e) {
      setLoading(false)
      notify({ type: 'error', message: t('workflow.common.importFailure') })
    }
  }

  return (
    <>
      <Modal
        className='w-[520px] rounded-2xl p-6'
        isShow={show}
        onClose={onCancel}
      >
        <div className='mb-3 flex items-center justify-between'>
          <div className='title-2xl-semi-bold text-text-primary'>{t('workflow.common.importDSL')}</div>
          <div className='flex h-[22px] w-[22px] cursor-pointer items-center justify-center' onClick={onCancel}>
            <RiCloseLine className='h-[18px] w-[18px] text-text-tertiary' />
          </div>
        </div>
        <div className='relative mb-2 flex grow gap-0.5 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-2 shadow-xs'>
          <div className='absolute left-0 top-0 h-full w-full bg-toast-warning-bg opacity-40' />
          <div className='flex items-start justify-center p-1'>
            <RiAlertFill className='h-4 w-4 shrink-0 text-text-warning-secondary' />
          </div>
          <div className='flex grow flex-col items-start gap-0.5 py-1'>
            <div className='system-xs-medium whitespace-pre-line text-text-primary'>{t('workflow.common.importDSLTip')}</div>
            <div className='flex items-start gap-1 self-stretch pb-0.5 pt-1'>
              <Button
                size='small'
                variant='secondary'
                className='z-[1000]'
                onClick={onBackup}
              >
                <RiFileDownloadLine className='h-3.5 w-3.5 text-components-button-secondary-text' />
                <div className='flex items-center justify-center gap-1 px-[3px]'>
                  {t('workflow.common.backupCurrentDraft')}
                </div>
              </Button>
            </div>
          </div>
        </div>
        <div>
          <div className='system-md-semibold pt-2 text-text-primary'>
            {t('workflow.common.chooseDSL')}
          </div>
          <div className='flex w-full flex-col items-start justify-center gap-4 self-stretch py-4'>
            <Uploader
              file={currentFile}
              updateFile={handleFile}
              className='!mt-0 w-full'
              accept='.pipeline'
              displayName='PIPELINE'
            />
          </div>
        </div>
        <div className='flex items-center justify-end gap-2 self-stretch pt-5'>
          <Button onClick={onCancel}>{t('app.newApp.Cancel')}</Button>
          <Button
            disabled={!currentFile || loading}
            variant='warning'
            onClick={handleImport}
            loading={loading}
          >
            {t('workflow.common.overwriteAndImport')}
          </Button>
        </div>
      </Modal>
      <Modal
        isShow={showErrorModal}
        onClose={() => setShowErrorModal(false)}
        className='w-[480px]'
      >
        <div className='flex flex-col items-start gap-2 self-stretch pb-4'>
          <div className='title-2xl-semi-bold text-text-primary'>{t('app.newApp.appCreateDSLErrorTitle')}</div>
          <div className='system-md-regular flex grow flex-col text-text-secondary'>
            <div>{t('app.newApp.appCreateDSLErrorPart1')}</div>
            <div>{t('app.newApp.appCreateDSLErrorPart2')}</div>
            <br />
            <div>{t('app.newApp.appCreateDSLErrorPart3')}<span className='system-md-medium'>{versions?.importedVersion}</span></div>
            <div>{t('app.newApp.appCreateDSLErrorPart4')}<span className='system-md-medium'>{versions?.systemVersion}</span></div>
          </div>
        </div>
        <div className='flex items-start justify-end gap-2 self-stretch pt-6'>
          <Button variant='secondary' onClick={() => setShowErrorModal(false)}>{t('app.newApp.Cancel')}</Button>
          <Button variant='primary' destructive onClick={onUpdateDSLConfirm}>{t('app.newApp.Confirm')}</Button>
        </div>
      </Modal>
    </>
  )
}

export default memo(UpdateDSLModal)
