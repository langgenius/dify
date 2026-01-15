import type { FC } from 'react'
import type { Viewport } from 'reactflow'
import type { SyncWorkflowDraft, SyncWorkflowDraftCallback } from '../types'
import type { Shape as HooksStoreShape } from '@/app/components/workflow/hooks-store'
import type { MentionConfig } from '@/app/components/workflow/nodes/_base/types'
import type { Edge, Node } from '@/app/components/workflow/types'
import { useCallback, useMemo } from 'react'
import { useStoreApi } from 'reactflow'
import { WorkflowWithInnerContext } from '@/app/components/workflow'
import { useSetWorkflowVarsWithValue } from '@/app/components/workflow/hooks/use-fetch-workflow-inspect-vars'
import { useInspectVarsCrudCommon } from '@/app/components/workflow/hooks/use-inspect-vars-crud-common'
import { FlowType } from '@/types/common'
import { useAvailableNodesMetaData } from '../hooks'
import SubGraphChildren from './sub-graph-children'

type SubGraphMainProps = {
  nodes: Node[]
  edges: Edge[]
  viewport: Viewport
  agentName: string
  extractorNodeId: string
  configsMap?: HooksStoreShape['configsMap']
  mentionConfig: MentionConfig
  onMentionConfigChange: (config: MentionConfig) => void
  onSave?: (nodes: Node[], edges: Edge[]) => void
  onSyncWorkflowDraft?: SyncWorkflowDraft
}

const SubGraphMain: FC<SubGraphMainProps> = ({
  nodes,
  edges,
  viewport,
  agentName,
  extractorNodeId,
  configsMap,
  mentionConfig,
  onMentionConfigChange,
  onSave,
  onSyncWorkflowDraft,
}) => {
  const reactFlowStore = useStoreApi()
  const availableNodesMetaData = useAvailableNodesMetaData()
  const flowType = configsMap?.flowType ?? FlowType.appFlow
  const flowId = configsMap?.flowId ?? ''
  const { fetchInspectVars } = useSetWorkflowVarsWithValue({
    flowType,
    flowId,
  })
  const inspectVarsCrud = useInspectVarsCrudCommon({
    flowType,
    flowId,
  })

  const handleSyncSubGraphDraft = useCallback(() => {
    const { getNodes, edges } = reactFlowStore.getState()
    onSave?.(getNodes() as Node[], edges as Edge[])
  }, [onSave, reactFlowStore])

  const handleSyncWorkflowDraft = useCallback(async (
    notRefreshWhenSyncError?: boolean,
    callback?: SyncWorkflowDraftCallback,
  ) => {
    handleSyncSubGraphDraft()
    if (onSyncWorkflowDraft) {
      await onSyncWorkflowDraft(notRefreshWhenSyncError, callback)
      return
    }
    try {
      callback?.onSuccess?.()
    }
    catch {
      callback?.onError?.()
    }
    finally {
      callback?.onSettled?.()
    }
  }, [handleSyncSubGraphDraft, onSyncWorkflowDraft])

  const hooksStore = useMemo(() => ({
    interactionMode: 'subgraph',
    availableNodesMetaData,
    configsMap,
    fetchInspectVars,
    ...inspectVarsCrud,
    doSyncWorkflowDraft: handleSyncWorkflowDraft,
    syncWorkflowDraftWhenPageClose: handleSyncSubGraphDraft,
  }), [availableNodesMetaData, configsMap, fetchInspectVars, handleSyncSubGraphDraft, handleSyncWorkflowDraft, inspectVarsCrud])

  return (
    <WorkflowWithInnerContext
      nodes={nodes}
      edges={edges}
      viewport={viewport}
      hooksStore={hooksStore as any}
      allowSelectionWhenReadOnly
      canvasReadOnly
      interactionMode="subgraph"
    >
      <SubGraphChildren
        agentName={agentName}
        extractorNodeId={extractorNodeId}
        mentionConfig={mentionConfig}
        onMentionConfigChange={onMentionConfigChange}
      />
    </WorkflowWithInnerContext>
  )
}

export default SubGraphMain
