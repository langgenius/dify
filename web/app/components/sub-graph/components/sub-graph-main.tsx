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
import { BlockEnum } from '@/app/components/workflow/types'
import { FlowType } from '@/types/common'
import { useAvailableNodesMetaData } from '../hooks'
import SubGraphChildren from './sub-graph-children'

type SubGraphMainBaseProps = {
  nodes: Node[]
  edges: Edge[]
  viewport: Viewport
  title: string
  extractorNodeId: string
  configsMap?: HooksStoreShape['configsMap']
  selectableNodeTypes?: BlockEnum[]
  onSave?: (nodes: Node[], edges: Edge[]) => void
  onSyncWorkflowDraft?: SyncWorkflowDraft
}

type SubGraphMainProps
  = | (SubGraphMainBaseProps & {
    variant: 'agent'
    mentionConfig: MentionConfig
    onMentionConfigChange: (config: MentionConfig) => void
  })
  | (SubGraphMainBaseProps & {
    variant: 'assemble'
  })

const SubGraphMain: FC<SubGraphMainProps> = (props) => {
  const {
    nodes,
    edges,
    viewport,
    variant,
    title,
    extractorNodeId,
    configsMap,
    selectableNodeTypes,
    onSave,
    onSyncWorkflowDraft,
  } = props
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

  const handleSyncSubGraphDraft = useCallback(async () => {
    const { getNodes, edges } = reactFlowStore.getState()
    await onSave?.(getNodes() as Node[], edges as Edge[])
  }, [onSave, reactFlowStore])

  const handleSyncWorkflowDraft = useCallback(async (
    notRefreshWhenSyncError?: boolean,
    callback?: SyncWorkflowDraftCallback,
  ) => {
    try {
      await handleSyncSubGraphDraft()
      if (onSyncWorkflowDraft) {
        await onSyncWorkflowDraft(notRefreshWhenSyncError, callback)
        return
      }
      callback?.onSuccess?.()
    }
    catch {
      callback?.onError?.()
    }
    finally {
      callback?.onSettled?.()
    }
  }, [handleSyncSubGraphDraft, onSyncWorkflowDraft])

  const resolvedSelectableTypes = useMemo(() => {
    if (selectableNodeTypes && selectableNodeTypes.length > 0)
      return selectableNodeTypes
    return variant === 'agent' ? [BlockEnum.LLM] : [BlockEnum.Code]
  }, [selectableNodeTypes, variant])

  const hooksStore = useMemo(() => ({
    interactionMode: 'subgraph',
    subGraphSelectableNodeTypes: resolvedSelectableTypes,
    availableNodesMetaData,
    configsMap,
    fetchInspectVars,
    ...inspectVarsCrud,
    doSyncWorkflowDraft: handleSyncWorkflowDraft,
    syncWorkflowDraftWhenPageClose: handleSyncSubGraphDraft,
  }), [availableNodesMetaData, configsMap, fetchInspectVars, handleSyncSubGraphDraft, handleSyncWorkflowDraft, inspectVarsCrud, resolvedSelectableTypes])

  const subGraphChildren = variant === 'agent'
    ? (
        <SubGraphChildren
          variant="agent"
          title={title}
          extractorNodeId={extractorNodeId}
          mentionConfig={props.mentionConfig}
          onMentionConfigChange={props.onMentionConfigChange}
        />
      )
    : (
        <SubGraphChildren
          variant="assemble"
          title={title}
          extractorNodeId={extractorNodeId}
        />
      )

  return (
    <WorkflowWithInnerContext
      nodes={nodes}
      edges={edges}
      viewport={viewport}
      // eslint-disable-next-line ts/no-explicit-any -- TODO: remove after typing boundary
      hooksStore={hooksStore as any}
      allowSelectionWhenReadOnly
      canvasReadOnly
      interactionMode="subgraph"
    >
      {subGraphChildren}
    </WorkflowWithInnerContext>
  )
}

export default SubGraphMain
