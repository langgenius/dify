import type { MouseEventHandler } from 'react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { WORKFLOW_DATA_UPDATE } from '@/app/components/workflow/constants'
import { usePluginDependencies } from '@/app/components/workflow/plugin-dependency/hooks'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { initialEdges, initialNodes } from '@/app/components/workflow/utils'
import { toast } from '@/app/notifications'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { DSLImportMode, DSLImportStatus } from '@/models/app'
import { useImportPipelineDSL, useImportPipelineDSLConfirm } from '@/service/use-pipeline'
import { fetchWorkflowDraft } from '@/service/workflow'
import { asyncRunSafe } from '@/utils'

type VersionInfo = {
  importedVersion: string
  systemVersion: string
}
type UseUpdateDSLModalParams = {
  onCancel: () => void
  onImport?: () => void
}
const isCompletedStatus = (status: DSLImportStatus): boolean =>
  status === DSLImportStatus.COMPLETED || status === DSLImportStatus.COMPLETED_WITH_WARNINGS
const getNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined

  const trimmedValue = value.trim()
  return trimmedValue || undefined
}
const getImportErrorMessage = async (error: unknown): Promise<string | undefined> => {
  if (error instanceof Error) return getNonEmptyString(error.message)

  return undefined
}
export const useUpdateDSLModal = ({ onCancel, onImport }: UseUpdateDSLModalParams) => {
  const { t } = useTranslation(['workflow'])
  const { eventEmitter } = useEventEmitterContextContext()
  const workflowStore = useWorkflowStore()
  const { handleCheckPluginDependencies } = usePluginDependencies()
  const { mutateAsync: importDSL } = useImportPipelineDSL()
  const { mutateAsync: importDSLConfirm } = useImportPipelineDSLConfirm()
  // File state
  const [currentFile, setDSLFile] = useState<File>()
  const [fileContent, setFileContent] = useState<string>()
  // Modal state
  const [show, setShow] = useState(true)
  const [showErrorModal, setShowErrorModal] = useState(false)
  // Import state
  const [loading, setLoading] = useState(false)
  const [versions, setVersions] = useState<VersionInfo>()
  const [importId, setImportId] = useState<string>()
  const isCreatingRef = useRef(false)
  const readFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      setFileContent(event.target?.result as string)
    }
    reader.readAsText(file)
  }
  const handleFile = (file?: File) => {
    setDSLFile(file)
    if (file) readFile(file)
    if (!file) setFileContent('')
  }
  const notifyError = useCallback(
    (message?: string) => {
      setLoading(false)
      toast.error(message || t(($) => $['common.importFailure'], { ns: 'workflow' }))
    },
    [t],
  )
  const updateWorkflow = useCallback(
    async (pipelineId: string) => {
      const { graph, hash, rag_pipeline_variables } = await fetchWorkflowDraft(
        `/rag/pipelines/${pipelineId}/workflows/draft`,
      )
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
      })
    },
    [eventEmitter],
  )
  const completeImport = useCallback(
    async (pipelineId: string | undefined, status: DSLImportStatus = DSLImportStatus.COMPLETED) => {
      if (!pipelineId) {
        notifyError()
        return
      }
      const [refreshError] = await asyncRunSafe(updateWorkflow(pipelineId))
      if (refreshError) {
        setLoading(false)
        if (refreshError.name !== 'AbortError')
          toast.warning(
            t(($) => $['common.importWarning'], { ns: 'workflow' }),
            {
              description: refreshError.message,
            },
          )
        window.location.reload()
        return
      }
      onImport?.()
      const [dependencyError] = await asyncRunSafe(handleCheckPluginDependencies(pipelineId, true))
      const isWarning = status === DSLImportStatus.COMPLETED_WITH_WARNINGS || !!dependencyError
      if (dependencyError?.name !== 'AbortError')
        toast(
          t(($) => $[isWarning ? 'common.importWarning' : 'common.importSuccess'], {
            ns: 'workflow',
          }),
          {
            type: isWarning ? 'warning' : 'success',
            description:
              [
                status === DSLImportStatus.COMPLETED_WITH_WARNINGS &&
                  t(($) => $['common.importWarningDetails'], { ns: 'workflow' }),
                dependencyError?.message,
              ]
                .filter(Boolean)
                .join('\n') || undefined,
          },
        )
      setLoading(false)
      onCancel()
    },
    [updateWorkflow, onImport, t, handleCheckPluginDependencies, onCancel, notifyError],
  )
  const showVersionMismatch = useCallback(
    (id: string, importedVersion?: string, systemVersion?: string) => {
      setShow(false)
      setTimeout(() => setShowErrorModal(true), 300)
      setVersions({
        importedVersion: importedVersion ?? '',
        systemVersion: systemVersion ?? '',
      })
      setImportId(id)
    },
    [],
  )
  const handleImport: MouseEventHandler = useCallback(async () => {
    const { pipelineId } = workflowStore.getState()
    if (isCreatingRef.current) return
    if (!currentFile) return
    isCreatingRef.current = true
    try {
      if (!pipelineId || !fileContent) return
      setLoading(true)
      const response = await importDSL({
        mode: DSLImportMode.YAML_CONTENT,
        yaml_content: fileContent,
        pipeline_id: pipelineId,
      })
      const { id, status, pipeline_id, imported_dsl_version, current_dsl_version } = response
      if (isCompletedStatus(status)) await completeImport(pipeline_id, status)
      else if (status === DSLImportStatus.PENDING)
        showVersionMismatch(id, imported_dsl_version, current_dsl_version)
      else notifyError(response.error)
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError'))
        notifyError(await getImportErrorMessage(error))
    } finally {
      isCreatingRef.current = false
      setLoading(false)
    }
  }, [
    currentFile,
    fileContent,
    workflowStore,
    importDSL,
    completeImport,
    showVersionMismatch,
    notifyError,
  ])
  const onUpdateDSLConfirm: MouseEventHandler = useCallback(async () => {
    if (!importId || isCreatingRef.current) return
    isCreatingRef.current = true
    setLoading(true)
    try {
      const { status, pipeline_id, error } = await importDSLConfirm(importId)
      if (isCompletedStatus(status)) {
        await completeImport(pipeline_id, status)
        return
      }
      if (status === DSLImportStatus.FAILED) notifyError(error)
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError'))
        notifyError(await getImportErrorMessage(error))
    } finally {
      isCreatingRef.current = false
      setLoading(false)
    }
  }, [importId, importDSLConfirm, completeImport, notifyError])
  return {
    currentFile,
    handleFile,
    show,
    showErrorModal,
    setShowErrorModal,
    loading,
    versions,
    handleImport,
    onUpdateDSLConfirm,
  }
}
