'use client'

import type { WorkflowProps } from '@/app/components/workflow'
import type { Shape as HooksStoreShape } from '@/app/components/workflow/hooks-store'
import type { SnippetDetailPayload, SnippetDetailUIModel, SnippetInputField } from '@/models/snippet'
import {
  useEffect,
  useMemo,
} from 'react'
import { useShallow } from 'zustand/react/shallow'
import { WorkflowWithInnerContext } from '@/app/components/workflow'
import { useAvailableNodesMetaData } from '@/app/components/workflow-app/hooks'
import { useSetWorkflowVarsWithValue } from '@/app/components/workflow/hooks/use-fetch-workflow-inspect-vars'
import { BlockEnum } from '@/app/components/workflow/types'
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
  snippetId: string
} & Pick<WorkflowProps, 'nodes' | 'edges' | 'viewport'>

type SnippetMainContentProps = {
  snippetId: string
  fields: SnippetInputField[]
  uiMeta: SnippetDetailUIModel
  editingField: SnippetInputField | null
  isEditorOpen: boolean
  isInputPanelOpen: boolean
  onToggleInputPanel: () => void
  onCloseInputPanel: () => void
  onOpenEditor: (field?: SnippetInputField | null) => void
  onCloseEditor: () => void
  onSubmitField: (field: SnippetInputField) => void
  onRemoveField: (index: number) => void
  onSortChange: (fields: SnippetInputField[]) => void
}

const SnippetMainContent = ({
  snippetId,
  fields,
  uiMeta,
  editingField,
  isEditorOpen,
  isInputPanelOpen,
  onToggleInputPanel,
  onCloseInputPanel,
  onOpenEditor,
  onCloseEditor,
  onSubmitField,
  onRemoveField,
  onSortChange,
}: SnippetMainContentProps) => {
  const {
    handlePublish,
    isPublishMenuOpen,
    isPublishing,
    setPublishMenuOpen,
  } = useSnippetPublish({
    snippetId,
  })

  return (
    <SnippetChildren
      snippetId={snippetId}
      fields={fields}
      uiMeta={uiMeta}
      editingField={editingField}
      isEditorOpen={isEditorOpen}
      isInputPanelOpen={isInputPanelOpen}
      isPublishMenuOpen={isPublishMenuOpen}
      isPublishing={isPublishing}
      onToggleInputPanel={onToggleInputPanel}
      onPublishMenuOpenChange={setPublishMenuOpen}
      onCloseInputPanel={onCloseInputPanel}
      onPublish={handlePublish}
      onOpenEditor={onOpenEditor}
      onCloseEditor={onCloseEditor}
      onSubmitField={onSubmitField}
      onRemoveField={onRemoveField}
      onSortChange={onSortChange}
    />
  )
}

const SnippetMain = ({
  payload,
  snippetId,
  nodes,
  edges,
  viewport,
}: SnippetMainProps) => {
  const { graph, uiMeta } = payload
  const {
    doSyncWorkflowDraft,
    syncWorkflowDraftWhenPageClose,
  } = useNodesSyncDraft(snippetId)
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
      node.metaData.type !== BlockEnum.HumanInput && node.metaData.type !== BlockEnum.End)

    if (!workflowAvailableNodesMetaData.nodesMap)
      return { nodes }

    const {
      [BlockEnum.HumanInput]: _humanInput,
      [BlockEnum.End]: _end,
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
    editingField,
    fields,
    isEditorOpen,
    isInputPanelOpen,
    openEditor,
    closeEditor,
    handleCloseInputPanel,
    handleRemoveField,
    handleSortChange,
    handleSubmitField,
    handleToggleInputPanel,
  } = useSnippetInputFieldActions({
    snippetId,
  })
  const {
    handleStartWorkflowRun,
    handleWorkflowStartRunInWorkflow,
  } = useSnippetStartRun({
    handleRun,
    inputFields: fields,
  })
  const { getWorkflowRunAndTraceUrl } = useGetRunAndTraceUrl(snippetId)

  useEffect(() => {
    reset()
  }, [reset, snippetId])

  useEffect(() => {
    setFields(payload.inputFields)
  }, [payload.inputFields, setFields, snippetId])

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
    <WorkflowWithInnerContext
      nodes={nodes}
      edges={edges}
      viewport={viewport ?? graph.viewport}
      hooksStore={hooksStore as unknown as Partial<HooksStoreShape>}
    >
      <SnippetMainContent
        snippetId={snippetId}
        fields={fields}
        uiMeta={uiMeta}
        editingField={editingField}
        isEditorOpen={isEditorOpen}
        isInputPanelOpen={isInputPanelOpen}
        onToggleInputPanel={handleToggleInputPanel}
        onCloseInputPanel={handleCloseInputPanel}
        onOpenEditor={openEditor}
        onCloseEditor={closeEditor}
        onSubmitField={handleSubmitField}
        onRemoveField={handleRemoveField}
        onSortChange={handleSortChange}
      />
    </WorkflowWithInnerContext>
  )
}

export default SnippetMain
