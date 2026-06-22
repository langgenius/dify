'use client'

import type { WorkflowProps } from '@/app/components/workflow'
import type { Shape as HooksStoreShape } from '@/app/components/workflow/hooks-store'
import type { SnippetCanvasData, SnippetDetailPayload, SnippetInputField } from '@/models/snippet'
import type { SnippetDraftSyncPayload } from '@/types/snippet'
import { toast } from '@langgenius/dify-ui/toast'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { WorkflowWithInnerContext } from '@/app/components/workflow'
import { useAvailableNodesMetaData } from '@/app/components/workflow-app/hooks'
import { useSetWorkflowVarsWithValue } from '@/app/components/workflow/hooks/use-fetch-workflow-inspect-vars'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import {
  initialEdges,
  initialNodes,
} from '@/app/components/workflow/utils'
import { useConfigsMap } from '../hooks/use-configs-map'
import { useGetRunAndTraceUrl } from '../hooks/use-get-run-and-trace-url'
import { useInspectVarsCrud } from '../hooks/use-inspect-vars-crud'
import { useNodesSyncDraft } from '../hooks/use-nodes-sync-draft'
import { useSnippetRefreshDraft } from '../hooks/use-snippet-refresh-draft'
import { useSnippetRun } from '../hooks/use-snippet-run'
import { useSnippetStartRun } from '../hooks/use-snippet-start-run'
import { useSnippetDetailStore } from '../store'
import { useSnippetInputFieldActions } from './hooks/use-snippet-input-field-actions'
import { useSnippetPublish } from './hooks/use-snippet-publish'
import SnippetChildren from './snippet-children'

type SnippetMainProps = {
  payload: SnippetDetailPayload
  draftPayload: SnippetDetailPayload
  hasInitialDraftChanges: boolean
  hasPublishedWorkflow: boolean
  snippetId: string
  draftNodes: WorkflowProps['nodes']
  draftEdges: WorkflowProps['edges']
  draftViewport?: WorkflowProps['viewport']
} & Pick<WorkflowProps, 'nodes' | 'edges' | 'viewport'>

type SnippetMainContentProps = {
  snippetId: string
  fields: SnippetInputField[]
  canSave: boolean
  onBeforePublish: () => Promise<Omit<SnippetDraftSyncPayload, 'hash'> | void>
  onSaved: (syncedDraftPayload?: Omit<SnippetDraftSyncPayload, 'hash'> | void) => void
}

const unsupportedSnippetBlockTypes = new Set([
  BlockEnum.HumanInput,
  BlockEnum.End,
  BlockEnum.KnowledgeRetrieval,
])

type LocalDraftState = {
  payload: SnippetDetailPayload
  nodes: WorkflowProps['nodes']
  edges: WorkflowProps['edges']
  viewport?: WorkflowProps['viewport']
}

const hasSnippetDraftNodes = (payload?: Omit<SnippetDraftSyncPayload, 'hash'> | void) => {
  const nodes = payload?.graph && typeof payload.graph === 'object'
    ? (payload.graph as { nodes?: unknown }).nodes
    : undefined

  return Array.isArray(nodes) && nodes.length > 0
}

const SnippetMainContent = ({
  snippetId,
  fields,
  canSave,
  onBeforePublish,
  onSaved,
}: SnippetMainContentProps) => {
  const { t } = useTranslation('snippet')
  const {
    handlePublish,
    isPublishing,
  } = useSnippetPublish({
    snippetId,
  })

  const handlePublishSnippet = useCallback(async () => {
    const syncedDraftPayload = await onBeforePublish()
    if (!syncedDraftPayload)
      return false

    if (!hasSnippetDraftNodes(syncedDraftPayload)) {
      toast.error(t('emptyGraphSaveError'))
      return false
    }

    const didSave = await handlePublish()
    if (didSave)
      onSaved(syncedDraftPayload)

    return didSave
  }, [handlePublish, onBeforePublish, onSaved, t])

  return (
    <SnippetChildren
      snippetId={snippetId}
      fields={fields}
      canSave={canSave}
      isPublishing={isPublishing}
      onPublish={handlePublishSnippet}
    />
  )
}

const SnippetMain = ({
  draftPayload,
  snippetId,
  draftNodes,
  draftEdges,
  draftViewport,
}: SnippetMainProps) => {
  const [localDraftState, setLocalDraftState] = useState<LocalDraftState>()
  const [localDraftSnippetId, setLocalDraftSnippetId] = useState(snippetId)
  if (localDraftSnippetId !== snippetId) {
    setLocalDraftState(undefined)
    setLocalDraftSnippetId(snippetId)
  }
  const currentCanvasNodeCount = useStore(state => state.nodes.filter(node => !node.data?._isTempNode).length)
  const effectiveDraftPayload = localDraftState?.payload ?? draftPayload
  const effectiveDraftNodes = localDraftState?.nodes ?? draftNodes
  const effectiveDraftEdges = localDraftState?.edges ?? draftEdges
  const effectiveDraftViewport = localDraftState?.viewport ?? draftViewport
  const { graph, snippet } = effectiveDraftPayload
  const canSave = currentCanvasNodeCount > 0
  const {
    doSyncWorkflowDraft: syncWorkflowDraft,
    syncWorkflowDraftWhenPageClose,
  } = useNodesSyncDraft(snippetId)
  const workflowStore = useWorkflowStore()
  const { handleRefreshWorkflowDraft } = useSnippetRefreshDraft(snippetId)
  const {
    handleBackupDraft,
    handleLoadBackupDraft,
    handleRestoreFromPublishedWorkflow,
    handleRun,
    handleStopRun,
  } = useSnippetRun(snippetId)
  const configsMap = useConfigsMap(snippetId)
  const { fetchInspectVars } = useSetWorkflowVarsWithValue({
    ...configsMap,
  })
  const {
    hasNodeInspectVars,
    hasSetInspectVar,
    fetchInspectVarValue,
    editInspectVarValue,
    renameInspectVarName,
    appendNodeInspectVars,
    deleteInspectVar,
    deleteNodeInspectorVars,
    deleteAllInspectorVars,
    isInspectVarEdited,
    resetToLastRunVar,
    invalidateSysVarValues,
    resetConversationVar,
    invalidateConversationVarValues,
  } = useInspectVarsCrud(snippetId)
  const workflowAvailableNodesMetaData = useAvailableNodesMetaData()
  const availableNodesMetaData = useMemo(() => {
    const nodes = workflowAvailableNodesMetaData.nodes.filter(node =>
      !unsupportedSnippetBlockTypes.has(node.metaData.type))

    if (!workflowAvailableNodesMetaData.nodesMap)
      return { nodes }

    const {
      [BlockEnum.HumanInput]: _humanInput,
      [BlockEnum.End]: _end,
      [BlockEnum.KnowledgeRetrieval]: _knowledgeRetrieval,
      ...nodesMap
    } = workflowAvailableNodesMetaData.nodesMap

    return {
      nodes,
      nodesMap,
    }
  }, [workflowAvailableNodesMetaData])
  const {
    reset,
    setFields,
    setNavigationState,
  } = useSnippetDetailStore(useShallow(state => ({
    reset: state.reset,
    setFields: state.setFields,
    setNavigationState: state.setNavigationState,
  })))
  const {
    fields,
    handleFieldsChange: handleSnippetFieldsChange,
  } = useSnippetInputFieldActions({
    canEdit: true,
    snippetId,
  })
  const {
    handleStartWorkflowRun,
    handleWorkflowStartRunInWorkflow,
  } = useSnippetStartRun({
    handleRun,
  })
  const { getWorkflowRunAndTraceUrl } = useGetRunAndTraceUrl(snippetId)
  useEffect(() => {
    reset()

    return () => reset()
  }, [reset, snippetId])

  useEffect(() => {
    setFields(effectiveDraftPayload.inputFields)
  }, [effectiveDraftPayload.inputFields, setFields, snippetId])

  useEffect(() => {
    workflowStore.setState({ canvasReadOnly: false })

    return () => {
      workflowStore.setState({ canvasReadOnly: false })
    }
  }, [workflowStore])

  useEffect(() => {
    workflowStore.temporal.getState().pause()
    workflowStore.getState().setWorkflowHistory({
      nodes: effectiveDraftNodes,
      edges: effectiveDraftEdges,
      workflowHistoryEvent: undefined,
      workflowHistoryEventMeta: undefined,
    })
    workflowStore.temporal.getState().clear()
    workflowStore.temporal.getState().resume()
  }, [effectiveDraftEdges, effectiveDraftNodes, workflowStore])

  const doSyncWorkflowDraft = useCallback((
    ...args: Parameters<typeof syncWorkflowDraft>
  ) => syncWorkflowDraft(...args), [syncWorkflowDraft])

  const handleFieldsChange = useCallback((nextFields: SnippetInputField[]) => {
    handleSnippetFieldsChange(nextFields)
  }, [handleSnippetFieldsChange])

  useEffect(() => {
    setNavigationState({
      snippetId,
      snippet,
      readonly: false,
      onFieldsChange: handleFieldsChange,
    })
  }, [handleFieldsChange, setNavigationState, snippet, snippetId])

  const updateLocalDraftFromSyncPayload = useCallback((
    syncedDraftPayload?: Omit<SnippetDraftSyncPayload, 'hash'> | void,
  ) => {
    const graph = syncedDraftPayload?.graph
    if (!graph || typeof graph !== 'object')
      return

    const graphRecord = graph as Record<string, unknown>
    const draftGraph: SnippetCanvasData = {
      nodes: Array.isArray(graphRecord.nodes) ? graphRecord.nodes as SnippetCanvasData['nodes'] : [],
      edges: Array.isArray(graphRecord.edges) ? graphRecord.edges as SnippetCanvasData['edges'] : [],
      viewport: graphRecord.viewport && typeof graphRecord.viewport === 'object'
        ? graphRecord.viewport as SnippetCanvasData['viewport']
        : { x: 0, y: 0, zoom: 1 },
    }
    const inputFields = Array.isArray(syncedDraftPayload.input_fields)
      ? syncedDraftPayload.input_fields as SnippetInputField[]
      : fields

    setLocalDraftState({
      payload: {
        ...draftPayload,
        graph: draftGraph,
        inputFields,
      },
      nodes: initialNodes(draftGraph.nodes, draftGraph.edges),
      edges: initialEdges(draftGraph.edges, draftGraph.nodes),
      viewport: draftGraph.viewport,
    })
    setFields(inputFields)
  }, [draftPayload, fields, setFields])

  const hooksStore = useMemo(() => {
    return {
      doSyncWorkflowDraft,
      syncWorkflowDraftWhenPageClose,
      handleRefreshWorkflowDraft,
      handleBackupDraft,
      handleLoadBackupDraft,
      handleRestoreFromPublishedWorkflow,
      handleRun,
      handleStopRun,
      handleStartWorkflowRun,
      handleWorkflowStartRunInWorkflow,
      getWorkflowRunAndTraceUrl,
      availableNodesMetaData,
      fetchInspectVars,
      hasNodeInspectVars,
      hasSetInspectVar,
      fetchInspectVarValue,
      editInspectVarValue,
      renameInspectVarName,
      appendNodeInspectVars,
      deleteInspectVar,
      deleteNodeInspectorVars,
      deleteAllInspectorVars,
      isInspectVarEdited,
      resetToLastRunVar,
      invalidateSysVarValues,
      resetConversationVar,
      invalidateConversationVarValues,
      configsMap,
    }
  }, [
    appendNodeInspectVars,
    availableNodesMetaData,
    configsMap,
    deleteAllInspectorVars,
    deleteInspectVar,
    deleteNodeInspectorVars,
    doSyncWorkflowDraft,
    editInspectVarValue,
    fetchInspectVarValue,
    fetchInspectVars,
    handleBackupDraft,
    handleRefreshWorkflowDraft,
    handleLoadBackupDraft,
    handleRestoreFromPublishedWorkflow,
    handleRun,
    handleStartWorkflowRun,
    handleStopRun,
    handleWorkflowStartRunInWorkflow,
    getWorkflowRunAndTraceUrl,
    hasNodeInspectVars,
    hasSetInspectVar,
    invalidateConversationVarValues,
    invalidateSysVarValues,
    isInspectVarEdited,
    renameInspectVarName,
    resetConversationVar,
    resetToLastRunVar,
    syncWorkflowDraftWhenPageClose,
  ])

  return (
    <div className="relative flex h-full min-h-0 min-w-0">
      <div className="relative min-h-0 min-w-0 grow">
        <WorkflowWithInnerContext
          key={`${snippetId}-draft`}
          nodes={effectiveDraftNodes}
          edges={effectiveDraftEdges}
          viewport={effectiveDraftViewport ?? graph.viewport}
          hooksStore={hooksStore as unknown as Partial<HooksStoreShape>}
        >
          <SnippetMainContent
            snippetId={snippetId}
            fields={fields}
            canSave={canSave}
            onBeforePublish={() => syncWorkflowDraft(true)}
            onSaved={updateLocalDraftFromSyncPayload}
          />
        </WorkflowWithInnerContext>
      </div>
    </div>
  )
}

export default SnippetMain
