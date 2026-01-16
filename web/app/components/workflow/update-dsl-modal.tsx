'use client'

import type { MouseEventHandler } from 'react'
import type {
  CommonNodeType,
  Node,
} from './types'
import {
  RiAlertFill,
  RiCloseLine,
  RiFileDownloadLine,
} from '@remixicon/react'
import { load as yamlLoad } from 'js-yaml'
import {
  memo,
  useCallback,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import Uploader from '@/app/components/app/create-from-dsl-modal/uploader'
import { useStore as useAppStore } from '@/app/components/app/store'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import { ToastContext } from '@/app/components/base/toast'
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
import { AppModeEnum } from '@/types/app'
import { WORKFLOW_DATA_UPDATE } from './constants'
import {
  BlockEnum,
  SupportUploadFileTypes,
} from './types'
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
  const { notify } = useContext(ToastContext)
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
        conversation_variables: conversation_variables || [],
        environment_variables: environment_variables || [],
      },
    } as any)
  }, [eventEmitter])

  const validateDSLContent = (content: string): boolean => {
    try {
      const data = yamlLoad(content) as any
      const nodes = data?.workflow?.graph?.nodes ?? []
      const invalidNodes = appDetail?.mode === AppModeEnum.ADVANCED_CHAT
        ? [
            BlockEnum.End,
            BlockEnum.TriggerWebhook,
            BlockEnum.TriggerSchedule,
            BlockEnum.TriggerPlugin,
          ]
        : [BlockEnum.Answer]
      const hasInvalidNode = nodes.some((node: Node<CommonNodeType>) => {
        return invalidNodes.includes(node?.data?.type)
      })
      if (hasInvalidNode) {
        notify({ type: 'error', message: t('common.importFailure', { ns: 'workflow' }) })
        return false
      }
      return true
    }
    catch {
      notify({ type: 'error', message: t('common.importFailure', { ns: 'workflow' }) })
      return false
    }
  }

  const isCreatingRef = useRef(false)
  const handleImport: MouseEventHandler = useCallback(async () => {
    if (isCreatingRef.current)
      return
    isCreatingRef.current = true
    if (!currentFile)
      return
    try {
      if (appDetail && fileContent && validateDSLContent(fileContent)) {
        setLoading(true)
        const response = await importDSL({ mode: DSLImportMode.YAML_CONTENT, yaml_content: fileContent, app_id: appDetail.id })
        const { id, status, app_id, imported_dsl_version, current_dsl_version } = response

        if (status === DSLImportStatus.COMPLETED || status === DSLImportStatus.COMPLETED_WITH_WARNINGS) {
          if (!app_id) {
            notify({ type: 'error', message: t('common.importFailure', { ns: 'workflow' }) })
            return
          }
          handleWorkflowUpdate(app_id)
          if (onImport)
            onImport()
          notify({
            type: status === DSLImportStatus.COMPLETED ? 'success' : 'warning',
            message: t(status === DSLImportStatus.COMPLETED ? 'common.importSuccess' : 'common.importWarning', { ns: 'workflow' }),
            children: status === DSLImportStatus.COMPLETED_WITH_WARNINGS && t('common.importWarningDetails', { ns: 'workflow' }),
          })
          await handleCheckPluginDependencies(app_id)
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
          notify({ type: 'error', message: t('common.importFailure', { ns: 'workflow' }) })
        }
      }
    }
    // eslint-disable-next-line unused-imports/no-unused-vars
    catch (e) {
      setLoading(false)
      notify({ type: 'error', message: t('common.importFailure', { ns: 'workflow' }) })
    }
    isCreatingRef.current = false
  }, [currentFile, fileContent, onCancel, notify, t, appDetail, onImport, handleWorkflowUpdate, handleCheckPluginDependencies])

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
          notify({ type: 'error', message: t('common.importFailure', { ns: 'workflow' }) })
          return
        }
        handleWorkflowUpdate(app_id)
        await handleCheckPluginDependencies(app_id)
        if (onImport)
          onImport()
        notify({ type: 'success', message: t('common.importSuccess', { ns: 'workflow' }) })
        setLoading(false)
        onCancel()
      }
      else if (status === DSLImportStatus.FAILED) {
        setLoading(false)
        notify({ type: 'error', message: t('common.importFailure', { ns: 'workflow' }) })
      }
    }
    // eslint-disable-next-line unused-imports/no-unused-vars
    catch (e) {
      setLoading(false)
      notify({ type: 'error', message: t('common.importFailure', { ns: 'workflow' }) })
    }
  }

  return (
    <>
      <Modal
        className="w-[520px] rounded-2xl p-6"
        isShow={show}
        onClose={onCancel}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="title-2xl-semi-bold text-text-primary">{t('common.importDSL', { ns: 'workflow' })}</div>
          <div className="flex h-[22px] w-[22px] cursor-pointer items-center justify-center" onClick={onCancel}>
            <RiCloseLine className="h-[18px] w-[18px] text-text-tertiary" />
          </div>
        </div>
        <div className="relative mb-2 flex grow gap-0.5 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-2 shadow-xs">
          <div className="absolute left-0 top-0 h-full w-full bg-toast-warning-bg opacity-40" />
          <div className="flex items-start justify-center p-1">
            <RiAlertFill className="h-4 w-4 shrink-0 text-text-warning-secondary" />
          </div>
          <div className="flex grow flex-col items-start gap-0.5 py-1">
            <div className="system-xs-medium whitespace-pre-line text-text-primary">{t('common.importDSLTip', { ns: 'workflow' })}</div>
            <div className="flex items-start gap-1 self-stretch pb-0.5 pt-1">
              <Button
                size="small"
                variant="secondary"
                className="z-[1000]"
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
          <div className="system-md-semibold pt-2 text-text-primary">
            {t('common.chooseDSL', { ns: 'workflow' })}
          </div>
          <div className="flex w-full flex-col items-start justify-center gap-4 self-stretch py-4">
            <Uploader
              file={currentFile}
              updateFile={handleFile}
              className="!mt-0 w-full"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 self-stretch pt-5">
          <Button onClick={onCancel}>{t('newApp.Cancel', { ns: 'app' })}</Button>
          <Button
            disabled={!currentFile || loading}
            variant="warning"
            onClick={handleImport}
            loading={loading}
          >
            {t('common.overwriteAndImport', { ns: 'workflow' })}
          </Button>
        </div>
      </Modal>
      <Modal
        isShow={showErrorModal}
        onClose={() => setShowErrorModal(false)}
        className="w-[480px]"
      >
        <div className="flex flex-col items-start gap-2 self-stretch pb-4">
          <div className="title-2xl-semi-bold text-text-primary">{t('newApp.appCreateDSLErrorTitle', { ns: 'app' })}</div>
          <div className="system-md-regular flex grow flex-col text-text-secondary">
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
          <Button variant="primary" destructive onClick={onUpdateDSLConfirm}>{t('newApp.Confirm', { ns: 'app' })}</Button>
        </div>
      </Modal>
    </>
  )
}

export default memo(UpdateDSLModal)
