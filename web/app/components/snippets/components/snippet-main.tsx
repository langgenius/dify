'use client'

import type { WorkflowProps } from '@/app/components/workflow'
import type { Shape as HooksStoreShape } from '@/app/components/workflow/hooks-store'
import type { SnippetDetailPayload, SnippetInputField } from '@/models/snippet'
import {
  useCallback,
  useEffect,
  useMemo,
} from 'react'
import { useShallow } from 'zustand/react/shallow'
import { WorkflowWithInnerContext } from '@/app/components/workflow'
import { useAvailableNodesMetaData } from '@/app/components/workflow-app/hooks'
import { useSetWorkflowVarsWithValue } from '@/app/components/workflow/hooks/use-fetch-workflow-inspect-vars'
import { BlockEnum } from '@/app/components/workflow/types'
import { useSnippetPublishedWorkflow } from '@/service/use-snippet-workflows'
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
import SnippetSidebar from './snippet-sidebar'

type SnippetMainProps = {
  payload: SnippetDetailPayload
  snippetId: string
} & Pick<WorkflowProps, 'nodes' | 'edges' | 'viewport'>

type SnippetMainContentProps = {
  snippetId: string
  fields: SnippetInputField[]
  onCancel: () => void | Promise<void>
}

const SnippetMainContent = ({
  snippetId,
  fields,
  onCancel,
}: SnippetMainContentProps) => {
  const {
    handlePublish,
    isPublishing,
  } = useSnippetPublish({
    snippetId,
  })

  return (
    <SnippetChildren
      snippetId={snippetId}
      fields={fields}
      isPublishing={isPublishing}
      onCancel={onCancel}
      onPublish={handlePublish}
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
  const { graph, snippet } = payload
  const {
    doSyncWorkflowDraft,
    syncInputFieldsDraft,
    syncWorkflowDraftWhenPageClose,
  } = useNodesSyncDraft(snippetId)
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
    fields,
    handleFieldsChange,
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

  const handleCancelChanges = useCallback(async () => {
    const workflow = publishedWorkflow ?? (await refetchPublishedWorkflow()).data
    if (!workflow)
      return

    handleRestoreFromPublishedWorkflow(workflow as never)

    const publishedInputFields = Array.isArray(workflow.input_fields)
      ? workflow.input_fields as SnippetInputField[]
      : []
    setFields(publishedInputFields)
    void syncInputFieldsDraft(publishedInputFields, {
      onRefresh: setFields,
    })
  }, [handleRestoreFromPublishedWorkflow, publishedWorkflow, refetchPublishedWorkflow, setFields, syncInputFieldsDraft])

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
      <SnippetSidebar
        snippet={snippet}
        fields={fields}
        onFieldsChange={handleFieldsChange}
      />
      <div className="relative min-h-0 min-w-0 grow">
        <WorkflowWithInnerContext
          nodes={nodes}
          edges={edges}
          viewport={viewport ?? graph.viewport}
          hooksStore={hooksStore as unknown as Partial<HooksStoreShape>}
        >
          <SnippetMainContent
            snippetId={snippetId}
            fields={fields}
            onCancel={handleCancelChanges}
          />
        </WorkflowWithInnerContext>
      </div>
    </div>
  )
}

export default SnippetMain
