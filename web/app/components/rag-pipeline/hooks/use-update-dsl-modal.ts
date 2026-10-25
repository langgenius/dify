import type { MouseEventHandler } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { WORKFLOW_DATA_UPDATE } from '@/app/components/workflow/constants'
import { knowledgePipelineIdentityAtom } from '@/app/components/workflow/editor-resource/state'
import { usePluginDependencies } from '@/app/components/workflow/plugin-dependency/hooks'
import { initialEdges, initialNodes } from '@/app/components/workflow/utils'
import { toast } from '@/app/notifications'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { DSLImportMode, DSLImportStatus } from '@/models/app'
import { consoleQuery } from '@/service/console'
import { fetchWorkflowDraft } from '@/service/workflow'
import { getErrorMessage } from '@/utils/error-message'

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
export const useUpdateDSLModal = ({ onCancel, onImport }: UseUpdateDSLModalParams) => {
  const { t } = useTranslation(['workflow'] as const)
  const { eventEmitter } = useEventEmitterContextContext()
  const { pipelineId } = useAtomValue(knowledgePipelineIdentityAtom)
  const { handleCheckPluginDependencies } = usePluginDependencies()
  const { mutateAsync: importDSL } = useMutation(
    consoleQuery.rag.pipelines.imports.post.mutationOptions(),
  )
  const { mutateAsync: importDSLConfirm } = useMutation(
    consoleQuery.rag.pipelines.imports.byImportId.confirm.post.mutationOptions(),
  )
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
    async (
      pipelineId: string | null | undefined,
      status: DSLImportStatus = DSLImportStatus.COMPLETED,
    ) => {
      if (!pipelineId) {
        notifyError()
        return
      }
      updateWorkflow(pipelineId)
      onImport?.()
      const isWarning = status === DSLImportStatus.COMPLETED_WITH_WARNINGS
      toast(
        t(($) => $[isWarning ? 'common.importWarning' : 'common.importSuccess'], {
          ns: 'workflow',
        }),
        {
          type: isWarning ? 'warning' : 'success',
          description: isWarning && t(($) => $['common.importWarningDetails'], { ns: 'workflow' }),
        },
      )
      await handleCheckPluginDependencies(pipelineId, true)
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
    if (isCreatingRef.current) return
    isCreatingRef.current = true
    if (!currentFile) return
    try {
      if (!pipelineId || !fileContent) return
      setLoading(true)
      const response = await importDSL({
        body: {
          mode: DSLImportMode.YAML_CONTENT,
          yaml_content: fileContent,
          pipeline_id: pipelineId,
        },
      })
      const { id, status, pipeline_id, imported_dsl_version, current_dsl_version } = response
      if (isCompletedStatus(status)) await completeImport(pipeline_id, status)
      else if (status === DSLImportStatus.PENDING)
        showVersionMismatch(id, imported_dsl_version, current_dsl_version)
      else notifyError(response.error)
    } catch (error) {
      notifyError(getErrorMessage(error)?.trim() || undefined)
    }
    isCreatingRef.current = false
  }, [
    currentFile,
    fileContent,
    pipelineId,
    importDSL,
    completeImport,
    showVersionMismatch,
    notifyError,
  ])
  const onUpdateDSLConfirm: MouseEventHandler = useCallback(async () => {
    if (!importId) return
    try {
      const { status, pipeline_id, error } = await importDSLConfirm({
        params: { import_id: importId },
      })
      if (status === DSLImportStatus.COMPLETED) {
        await completeImport(pipeline_id)
        return
      }
      if (status === DSLImportStatus.FAILED) notifyError(error)
    } catch (error) {
      notifyError(getErrorMessage(error)?.trim() || undefined)
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
