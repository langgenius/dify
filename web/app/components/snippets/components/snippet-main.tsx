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
  useRef,
  useState,
} from 'react'
import { useTranslation } from '#i18n'
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
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { useRouter } from '@/next/navigation'
import { useSnippetPublishedWorkflow } from '@/service/use-snippet-workflows'
import { useConfigsMap } from '../hooks/use-configs-map'
import { useGetRunAndTraceUrl } from '../hooks/use-get-run-and-trace-url'
import { useInspectVarsCrud } from '../hooks/use-inspect-vars-crud'
import { useNodesSyncDraft } from '../hooks/use-nodes-sync-draft'
import { useSnippetRefreshDraft } from '../hooks/use-snippet-refresh-draft'
import { useSnippetRun } from '../hooks/use-snippet-run'
import { useSnippetStartRun } from '../hooks/use-snippet-start-run'
import { useSnippetDetailStore } from '../store'
import { canCreateAndModifySnippets } from '../utils/permission'
import { useSnippetInputFieldActions } from './hooks/use-snippet-input-field-actions'
import { useSnippetPublish } from './hooks/use-snippet-publish'
import SaveBeforeLeavingDialog from './save-before-leaving-dialog'
import SnippetChildren from './snippet-children'
import SnippetSidebar from './snippet-sidebar'

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
  canDiscardChanges: boolean
  canEdit: boolean
  canSave: boolean
  hasDraftChanges: boolean
  isEditing: boolean
  onBeforePublish: () => Promise<Omit<SnippetDraftSyncPayload, 'hash'> | void>
  onCancel: () => void | Promise<void>
  onDiscardRoute: () => void | Promise<void>
  onEdit: () => void
  onExitEditing: () => void | Promise<void>
  onExitEditingWithoutSave: () => void | Promise<void>
  onSaved: (syncedDraftPayload?: Omit<SnippetDraftSyncPayload, 'hash'> | void) => void
  onSavedAndExitEditing: () => void
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
  canDiscardChanges,
  canEdit,
  canSave,
  hasDraftChanges,
  isEditing,
  onBeforePublish,
  onCancel,
  onDiscardRoute,
  onEdit,
  onExitEditing,
  onExitEditingWithoutSave,
  onSaved,
  onSavedAndExitEditing,
}: SnippetMainContentProps) => {
  const { push } = useRouter()
  const { t } = useTranslation('snippet')
  const [pendingHref, setPendingHref] = useState<string>()
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

  const handleSaveAndExitEditing = useCallback(async () => {
    const didSave = await handlePublishSnippet()
    if (didSave)
      onSavedAndExitEditing()
  }, [handlePublishSnippet, onSavedAndExitEditing])

  const navigateToPendingHref = useCallback((href: string) => {
    const url = new URL(href, window.location.href)
    if (url.origin === window.location.origin)
      push(`${url.pathname}${url.search}${url.hash}`)
    else
      window.location.assign(url.href)
  }, [push])

  const handleDiscardAndRoute = useCallback(async () => {
    if (!pendingHref)
      return

    await onDiscardRoute()
    navigateToPendingHref(pendingHref)
    setPendingHref(undefined)
  }, [navigateToPendingHref, onDiscardRoute, pendingHref])

  const handleSaveAndRoute = useCallback(async () => {
    if (!pendingHref)
      return

    const didSave = await handlePublishSnippet()
    if (!didSave)
      return

    navigateToPendingHref(pendingHref)
    setPendingHref(undefined)
  }, [handlePublishSnippet, navigateToPendingHref, pendingHref])

  useEffect(() => {
    if (!isEditing || !hasDraftChanges)
      return

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasDraftChanges, isEditing])

  useEffect(() => {
    if (!isEditing || !hasDraftChanges)
      return

    const handleClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented
        || event.button !== 0
        || event.metaKey
        || event.ctrlKey
        || event.shiftKey
        || event.altKey
      ) {
        return
      }

      const anchor = (event.target as Element | null)?.closest?.('a[href]')
      if (!(anchor instanceof HTMLAnchorElement))
        return

      if (anchor.target && anchor.target !== '_self')
        return
      if (anchor.hasAttribute('download'))
        return

      const nextUrl = new URL(anchor.href, window.location.href)
      const currentUrl = new URL(window.location.href)
      if (nextUrl.href === currentUrl.href)
        return

      event.preventDefault()
      event.stopPropagation()
      setPendingHref(nextUrl.href)
    }

    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [hasDraftChanges, isEditing])

  return (
    <>
      <SnippetChildren
        snippetId={snippetId}
        fields={fields}
        canDiscardChanges={canDiscardChanges}
        canEdit={canEdit}
        canSave={canSave}
        hasDraftChanges={hasDraftChanges}
        isEditing={isEditing}
        isPublishing={isPublishing}
        onCancel={onCancel}
        onEdit={onEdit}
        onExitEditing={onExitEditing}
        onExitEditingWithoutSave={onExitEditingWithoutSave}
        onPublish={handlePublishSnippet}
        onSaveAndExitEditing={handleSaveAndExitEditing}
      />
      <SaveBeforeLeavingDialog
        open={!!pendingHref}
        onOpenChange={open => !open && setPendingHref(undefined)}
        disabled={isPublishing}
        saveDisabled={!canSave}
        loading={isPublishing}
        onDiscard={handleDiscardAndRoute}
        onSave={handleSaveAndRoute}
      />
    </>
  )
}

const SnippetMain = ({
  payload,
  draftPayload,
  hasInitialDraftChanges,
  hasPublishedWorkflow,
  snippetId,
  nodes,
  edges,
  viewport,
  draftNodes,
  draftEdges,
  draftViewport,
}: SnippetMainProps) => {
  const workspacePermissionKeys = useAppContextWithSelector(state => state.workspacePermissionKeys)
  const canCreateAndModifySnippet = canCreateAndModifySnippets(workspacePermissionKeys)
  const [isEditingState, setIsEditingState] = useState(!hasPublishedWorkflow)
  const isEditing = canCreateAndModifySnippet && isEditingState
  const [localDraftState, setLocalDraftState] = useState<LocalDraftState>()
  const [draftChangeState, setDraftChangeState] = useState({
    initial: hasInitialDraftChanges,
    snippetId,
    value: hasInitialDraftChanges,
  })
  if (draftChangeState.snippetId !== snippetId || draftChangeState.initial !== hasInitialDraftChanges) {
    setLocalDraftState(undefined)
    setDraftChangeState({
      initial: hasInitialDraftChanges,
      snippetId,
      value: hasInitialDraftChanges,
    })
  }
  const hasDraftChanges = draftChangeState.value
  const currentCanvasNodeCount = useStore(state => state.nodes.filter(node => !node.data?._isTempNode).length)
  const skipNextForcedDraftSyncRef = useRef(false)
  const setHasDraftChanges = useCallback((value: boolean) => {
    setDraftChangeState(prev => ({
      ...prev,
      value,
    }))
  }, [])
  const effectiveDraftPayload = localDraftState?.payload ?? draftPayload
  const effectiveDraftNodes = localDraftState?.nodes ?? draftNodes
  const effectiveDraftEdges = localDraftState?.edges ?? draftEdges
  const effectiveDraftViewport = localDraftState?.viewport ?? draftViewport
  const displayPayload = isEditing ? effectiveDraftPayload : payload
  const displayNodes = isEditing ? effectiveDraftNodes : nodes
  const displayEdges = isEditing ? effectiveDraftEdges : edges
  const displayViewport = isEditing ? effectiveDraftViewport : viewport
  const { graph, snippet } = displayPayload
  const canSave = currentCanvasNodeCount > 0
  const {
    doSyncWorkflowDraft: syncWorkflowDraft,
    syncInputFieldsDraft,
    syncWorkflowDraftWhenPageClose,
  } = useNodesSyncDraft(snippetId)
  const workflowStore = useWorkflowStore()
  const publishedWorkflowQuery = useSnippetPublishedWorkflow(snippetId)
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
  const {
    data: publishedWorkflow,
    refetch: refetchPublishedWorkflow,
  } = publishedWorkflowQuery
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
  } = useSnippetDetailStore(useShallow(state => ({
    reset: state.reset,
    setFields: state.setFields,
  })))
  const {
    fields,
    handleFieldsChange,
  } = useSnippetInputFieldActions({
    canEdit: canCreateAndModifySnippet,
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
  }, [reset, snippetId])

  useEffect(() => {
    setFields(displayPayload.inputFields)
  }, [displayPayload.inputFields, setFields, snippetId])

  useEffect(() => {
    workflowStore.setState({ canvasReadOnly: !isEditing })

    return () => {
      workflowStore.setState({ canvasReadOnly: false })
    }
  }, [isEditing, workflowStore])

  useEffect(() => {
    workflowStore.temporal.getState().pause()
    workflowStore.getState().setWorkflowHistory({
      nodes: displayNodes,
      edges: displayEdges,
      workflowHistoryEvent: undefined,
      workflowHistoryEventMeta: undefined,
    })
    workflowStore.temporal.getState().clear()
    workflowStore.temporal.getState().resume()
  }, [displayEdges, displayNodes, workflowStore])

  const doSyncWorkflowDraft = useCallback((
    ...args: Parameters<typeof syncWorkflowDraft>
  ) => {
    if (!canCreateAndModifySnippet || !isEditing)
      return Promise.resolve()

    const [
      notRefreshWhenSyncError,
      callback,
    ] = args
    if (skipNextForcedDraftSyncRef.current && notRefreshWhenSyncError === true && !callback) {
      skipNextForcedDraftSyncRef.current = false
      return Promise.resolve()
    }

    if (isEditing)
      setHasDraftChanges(true)

    return syncWorkflowDraft(...args)
  }, [canCreateAndModifySnippet, isEditing, setHasDraftChanges, syncWorkflowDraft])

  const syncWorkflowDraftWhenPageCloseInEditing = useCallback(() => {
    if (!canCreateAndModifySnippet || !isEditing)
      return

    syncWorkflowDraftWhenPageClose()
  }, [canCreateAndModifySnippet, isEditing, syncWorkflowDraftWhenPageClose])

  const handleFieldsChangeInEditing = useCallback((nextFields: SnippetInputField[]) => {
    if (!canCreateAndModifySnippet || !isEditing)
      return

    handleFieldsChange(nextFields)
    setHasDraftChanges(true)
  }, [canCreateAndModifySnippet, handleFieldsChange, isEditing, setHasDraftChanges])

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

  const handleCancelChanges = useCallback(async () => {
    if (!canCreateAndModifySnippet)
      return

    const workflow = publishedWorkflow ?? (await refetchPublishedWorkflow()).data
    if (!workflow)
      return

    handleRestoreFromPublishedWorkflow(workflow as never)

    const publishedInputFields = Array.isArray(workflow.input_fields)
      ? workflow.input_fields as SnippetInputField[]
      : []
    updateLocalDraftFromSyncPayload({
      graph: workflow.graph,
      input_fields: publishedInputFields,
    })
    void syncInputFieldsDraft(publishedInputFields, {
      onRefresh: setFields,
    })
    setHasDraftChanges(false)
  }, [canCreateAndModifySnippet, handleRestoreFromPublishedWorkflow, publishedWorkflow, refetchPublishedWorkflow, setFields, setHasDraftChanges, syncInputFieldsDraft, updateLocalDraftFromSyncPayload])

  const handleExitEditing = useCallback(async () => {
    if (!canCreateAndModifySnippet || hasDraftChanges)
      return

    setIsEditingState(false)
  }, [canCreateAndModifySnippet, hasDraftChanges])

  const handleExitEditingWithoutSave = useCallback(async () => {
    if (!canCreateAndModifySnippet)
      return

    const syncedDraftPayload = await syncWorkflowDraft(true)
    updateLocalDraftFromSyncPayload(syncedDraftPayload)
    skipNextForcedDraftSyncRef.current = true
    setIsEditingState(false)
  }, [canCreateAndModifySnippet, syncWorkflowDraft, updateLocalDraftFromSyncPayload])

  const handleDiscardAndRoute = useCallback(async () => {
    if (!canCreateAndModifySnippet)
      return

    const syncedDraftPayload = await syncWorkflowDraft(true)
    updateLocalDraftFromSyncPayload(syncedDraftPayload)
    skipNextForcedDraftSyncRef.current = true
  }, [canCreateAndModifySnippet, syncWorkflowDraft, updateLocalDraftFromSyncPayload])

  const handleEdit = useCallback(() => {
    if (!canCreateAndModifySnippet)
      return

    skipNextForcedDraftSyncRef.current = true
    setIsEditingState(true)
  }, [canCreateAndModifySnippet])

  const hooksStore = useMemo(() => {
    return {
      doSyncWorkflowDraft,
      syncWorkflowDraftWhenPageClose: syncWorkflowDraftWhenPageCloseInEditing,
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
    syncWorkflowDraftWhenPageCloseInEditing,
  ])

  return (
    <div className="relative flex h-full min-h-0 min-w-0">
      <SnippetSidebar
        snippet={snippet}
        fields={fields}
        readonly={!isEditing}
        onFieldsChange={handleFieldsChangeInEditing}
      />
      <div className="relative min-h-0 min-w-0 grow">
        <WorkflowWithInnerContext
          key={`${snippetId}-${isEditing ? 'draft' : 'published'}`}
          nodes={displayNodes}
          edges={displayEdges}
          viewport={displayViewport ?? graph.viewport}
          hooksStore={hooksStore as unknown as Partial<HooksStoreShape>}
        >
          <SnippetMainContent
            snippetId={snippetId}
            fields={fields}
            canDiscardChanges={hasPublishedWorkflow}
            canEdit={canCreateAndModifySnippet}
            canSave={canSave}
            hasDraftChanges={hasDraftChanges}
            isEditing={isEditing}
            onBeforePublish={() => syncWorkflowDraft(true)}
            onCancel={handleCancelChanges}
            onDiscardRoute={handleDiscardAndRoute}
            onEdit={handleEdit}
            onExitEditing={handleExitEditing}
            onExitEditingWithoutSave={handleExitEditingWithoutSave}
            onSaved={(syncedDraftPayload) => {
              updateLocalDraftFromSyncPayload(syncedDraftPayload)
              setHasDraftChanges(false)
            }}
            onSavedAndExitEditing={() => {
              setHasDraftChanges(false)
              setIsEditingState(false)
            }}
          />
        </WorkflowWithInnerContext>
      </div>
    </div>
  )
}

export default SnippetMain
