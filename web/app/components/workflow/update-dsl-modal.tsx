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
import { WORKFLOW_DATA_UPDATE } from './constants'
import {
  SupportUploadFileTypes,
} from './types'
import {
  initialEdges,
  initialNodes,
} from './utils'
import {
  importDSL,
  importDSLConfirm,
} from '@/service/apps'
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
import { useStore as useAppStore } from '@/app/components/app/store'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'

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
  const appDetail = useAppStore(s => s.appDetail)
  const [currentFile, setDSLFile] = useState<File>()
  const [fileContent, setFileContent] = useState<string>()
  const [loading, setLoading] = useState(false)
  const { eventEmitter } = useEventEmitterContextContext()
  const [show, setShow] = useState(true)
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [versions, setVersions] = useState<{ importedVersion: string; systemVersion: string }>()
  const [importId, setImportId] = useState<string>()

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

  const handleWorkflowUpdate = async (app_id: string) => {
    const {
      graph,
      features,
      hash,
    } = await fetchWorkflowDraft(`/apps/${app_id}/workflows/draft`)

    const { nodes, edges, viewport } = graph
    const newFeatures = {
      file: {
        image: {
          enabled: !!features.file_upload?.image?.enabled,
          number_limits: features.file_upload?.image?.number_limits || 3,
          transfer_methods: features.file_upload?.image?.transfer_methods || ['local_file', 'remote_url'],
        },
        enabled: !!(features.file_upload?.enabled || features.file_upload?.image?.enabled),
        allowed_file_types: features.file_upload?.allowed_file_types || [SupportUploadFileTypes.image],
        allowed_file_extensions: features.file_upload?.allowed_file_extensions || FILE_EXTS[SupportUploadFileTypes.image].map(ext => `.${ext}`),
        allowed_file_upload_methods: features.file_upload?.allowed_file_upload_methods || features.file_upload?.image?.transfer_methods || ['local_file', 'remote_url'],
        number_limits: features.file_upload?.number_limits || features.file_upload?.image?.number_limits || 3,
      },
      opening: {
        enabled: !!features.opening_statement,
        opening_statement: features.opening_statement,
        suggested_questions: features.suggested_questions,
      },
      suggested: features.suggested_questions_after_answer || { enabled: false },
      speech2text: features.speech_to_text || { enabled: false },
      text2speech: features.text_to_speech || { enabled: false },
      citation: features.retriever_resource || { enabled: false },
      moderation: features.sensitive_word_avoidance || { enabled: false },
    }

    eventEmitter?.emit({
      type: WORKFLOW_DATA_UPDATE,
      payload: {
        nodes: initialNodes(nodes, edges),
        edges: initialEdges(edges, nodes),
        viewport,
        features: newFeatures,
        hash,
      },
    } as any)
  }

  const isCreatingRef = useRef(false)
  const handleImport: MouseEventHandler = useCallback(async () => {
    if (isCreatingRef.current)
      return
    isCreatingRef.current = true
    if (!currentFile)
      return
    try {
      if (appDetail && fileContent) {
        setLoading(true)
        const response = await importDSL({ mode: DSLImportMode.YAML_CONTENT, yaml_content: fileContent, app_id: appDetail.id })
        const { id, status, app_id, imported_dsl_version, current_dsl_version } = response
        if (status === DSLImportStatus.COMPLETED || status === DSLImportStatus.COMPLETED_WITH_WARNINGS) {
          if (!app_id) {
            notify({ type: 'error', message: t('workflow.common.importFailure') })
            return
          }
          handleWorkflowUpdate(app_id)
          if (onImport)
            onImport()
          notify({
            type: status === DSLImportStatus.COMPLETED ? 'success' : 'warning',
            message: t(status === DSLImportStatus.COMPLETED ? 'workflow.common.importSuccess' : 'workflow.common.importWarning'),
            children: status === DSLImportStatus.COMPLETED_WITH_WARNINGS && t('workflow.common.importWarningDetails'),
          })
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
    catch (e) {
      setLoading(false)
      notify({ type: 'error', message: t('workflow.common.importFailure') })
    }
    isCreatingRef.current = false
  }, [currentFile, fileContent, onCancel, notify, t, eventEmitter, appDetail, onImport])

  const onUpdateDSLConfirm: MouseEventHandler = async () => {
    try {
      if (!importId)
        return
      const response = await importDSLConfirm({
        import_id: importId,
      })

      const { status, app_id } = response

      if (status === DSLImportStatus.COMPLETED) {
        if (!app_id) {
          notify({ type: 'error', message: t('workflow.common.importFailure') })
          return
        }
        handleWorkflowUpdate(app_id)
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
    catch (e) {
      setLoading(false)
      notify({ type: 'error', message: t('workflow.common.importFailure') })
    }
  }

  return (
    <>
      <Modal
        className='p-6 w-[520px] rounded-2xl'
        isShow={show}
        onClose={onCancel}
      >
        <div className='flex items-center justify-between mb-3'>
          <div className='title-2xl-semi-bold text-text-primary'>{t('workflow.common.importDSL')}</div>
          <div className='flex items-center justify-center w-[22px] h-[22px] cursor-pointer' onClick={onCancel}>
            <RiCloseLine className='w-[18px] h-[18px] text-text-tertiary' />
          </div>
        </div>
        <div className='flex relative p-2 mb-2 gap-0.5 flex-grow rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-xs overflow-hidden'>
          <div className='absolute top-0 left-0 w-full h-full opacity-40 bg-[linear-gradient(92deg,rgba(247,144,9,0.25)_0%,rgba(255,255,255,0.00)_100%)]' />
          <div className='flex p-1 justify-center items-start'>
            <RiAlertFill className='w-4 h-4 flex-shrink-0 text-text-warning-secondary' />
          </div>
          <div className='flex py-1 flex-col items-start gap-0.5 flex-grow'>
            <div className='text-text-primary system-xs-medium whitespace-pre-line'>{t('workflow.common.importDSLTip')}</div>
            <div className='flex pt-1 pb-0.5 items-start gap-1 self-stretch'>
              <Button
                size='small'
                variant='secondary'
                className='z-[1000]'
                onClick={onBackup}
              >
                <RiFileDownloadLine className='w-3.5 h-3.5 text-components-button-secondary-text' />
                <div className='flex px-[3px] justify-center items-center gap-1'>
                  {t('workflow.common.backupCurrentDraft')}
                </div>
              </Button>
            </div>
          </div>
        </div>
        <div>
          <div className='pt-2 text-text-primary system-md-semibold'>
            {t('workflow.common.chooseDSL')}
          </div>
          <div className='flex w-full py-4 flex-col justify-center items-start gap-4 self-stretch'>
            <Uploader
              file={currentFile}
              updateFile={handleFile}
              className='!mt-0 w-full'
            />
          </div>
        </div>
        <div className='flex pt-5 gap-2 items-center justify-end self-stretch'>
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
        <div className='flex pb-4 flex-col items-start gap-2 self-stretch'>
          <div className='text-text-primary title-2xl-semi-bold'>{t('app.newApp.appCreateDSLErrorTitle')}</div>
          <div className='flex flex-grow flex-col text-text-secondary system-md-regular'>
            <div>{t('app.newApp.appCreateDSLErrorPart1')}</div>
            <div>{t('app.newApp.appCreateDSLErrorPart2')}</div>
            <br />
            <div>{t('app.newApp.appCreateDSLErrorPart3')}<span className='system-md-medium'>{versions?.importedVersion}</span></div>
            <div>{t('app.newApp.appCreateDSLErrorPart4')}<span className='system-md-medium'>{versions?.systemVersion}</span></div>
          </div>
        </div>
        <div className='flex pt-6 justify-end items-start gap-2 self-stretch'>
          <Button variant='secondary' onClick={() => setShowErrorModal(false)}>{t('app.newApp.Cancel')}</Button>
          <Button variant='primary' destructive onClick={onUpdateDSLConfirm}>{t('app.newApp.Confirm')}</Button>
        </div>
      </Modal>
    </>
  )
}

export default memo(UpdateDSLModal)
