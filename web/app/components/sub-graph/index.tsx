import type { FC } from 'react'
import type { Viewport } from 'reactflow'
import type { SubGraphProps } from './types'
import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store'
import { memo, useEffect, useMemo } from 'react'
import WorkflowWithDefaultContext from '@/app/components/workflow'
import { WorkflowContextProvider } from '@/app/components/workflow/context'
import { useStore } from '@/app/components/workflow/store'
import SubGraphMain from './components/sub-graph-main'
import { useSubGraphNodes } from './hooks'
import { createSubGraphSlice } from './store'
import {
  buildSubGraphEdges,
  buildSubGraphExtractorDisplayNode,
  buildSubGraphStartNode,
  defaultViewport,
  getSubGraphExtractorNodeId,
  getSubGraphPromptText,
  getSubGraphSourceTitle,
} from './utils'

const resolvedDefaultViewport: Viewport = defaultViewport

const SubGraphContent: FC<SubGraphProps> = (props) => {
  const {
    isOpen,
    parentAvailableNodes,
    parentAvailableVars,
    configsMap,
    selectableNodeTypes,
    onSave,
    onSyncWorkflowDraft,
    pendingSingleRun,
    onPendingSingleRunHandled,
  } = props

  const setParentAvailableVars = useStore(state => state.setParentAvailableVars)
  const setParentAvailableNodes = useStore(state => state.setParentAvailableNodes)

  useEffect(() => {
    setParentAvailableVars?.(parentAvailableVars || [])
    setParentAvailableNodes?.(parentAvailableNodes || [])
  }, [parentAvailableNodes, parentAvailableVars, setParentAvailableNodes, setParentAvailableVars])

  const sourceTitle = useMemo(() => getSubGraphSourceTitle(props), [props])
  const promptText = useMemo(() => getSubGraphPromptText(props), [props])
  const startNode = useMemo(() => buildSubGraphStartNode(props, sourceTitle), [props, sourceTitle])
  const extractorDisplayNode = useMemo(() => buildSubGraphExtractorDisplayNode(props, promptText), [props, promptText])

  const nodesSource = useMemo(() => {
    if (!extractorDisplayNode)
      return [startNode]

    return [startNode, extractorDisplayNode]
  }, [extractorDisplayNode, startNode])

  const edgesSource = useMemo(() => buildSubGraphEdges(props, startNode, extractorDisplayNode), [extractorDisplayNode, props, startNode])

  const { nodes, edges } = useSubGraphNodes(nodesSource, edgesSource)
  const extractorNodeId = getSubGraphExtractorNodeId(props)

  if (props.variant === 'agent') {
    return (
      <WorkflowWithDefaultContext
        nodes={nodes}
        edges={edges}
      >
        <SubGraphMain
          variant="agent"
          nodes={nodes}
          edges={edges}
          viewport={resolvedDefaultViewport}
          title={sourceTitle}
          extractorNodeId={extractorNodeId}
          configsMap={configsMap}
          isOpen={isOpen}
          pendingSingleRun={pendingSingleRun}
          onPendingSingleRunHandled={onPendingSingleRunHandled}
          nestedNodeConfig={props.nestedNodeConfig}
          onNestedNodeConfigChange={props.onNestedNodeConfigChange}
          selectableNodeTypes={selectableNodeTypes}
          onSave={onSave}
          onSyncWorkflowDraft={onSyncWorkflowDraft}
        />
      </WorkflowWithDefaultContext>
    )
  }

  return (
    <WorkflowWithDefaultContext
      nodes={nodes}
      edges={edges}
    >
      <SubGraphMain
        variant="assemble"
        nodes={nodes}
        edges={edges}
        viewport={resolvedDefaultViewport}
        title={sourceTitle}
        extractorNodeId={extractorNodeId}
        configsMap={configsMap}
        isOpen={isOpen}
        pendingSingleRun={pendingSingleRun}
        onPendingSingleRunHandled={onPendingSingleRunHandled}
        nestedNodeConfig={props.nestedNodeConfig}
        onNestedNodeConfigChange={props.onNestedNodeConfigChange}
        selectableNodeTypes={selectableNodeTypes}
        onSave={onSave}
        onSyncWorkflowDraft={onSyncWorkflowDraft}
      />
    </WorkflowWithDefaultContext>
  )
}

const SubGraph: FC<SubGraphProps> = (props) => {
  return (
    <WorkflowContextProvider
      injectWorkflowStoreSliceFn={createSubGraphSlice as InjectWorkflowStoreSliceFn}
    >
      <SubGraphContent {...props} />
    </WorkflowContextProvider>
  )
}

export default memo(SubGraph)
