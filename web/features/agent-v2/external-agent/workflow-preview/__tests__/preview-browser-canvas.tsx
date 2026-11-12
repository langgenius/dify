import type { ComponentType } from 'react'
import type { NodeProps } from 'reactflow'
import type { ExternalAgentWorkflowPreviewNodeData } from '../types'
import type { CommonNodeType, WorkflowDataUpdater } from '@/app/components/workflow/types'
import ReactFlow, { Handle, Position, useStore as useReactflow } from 'reactflow'
import { useShallow } from 'zustand/react/shallow'
import { useNodesSyncDraftByCanEdit } from '@/app/components/workflow-app/hooks/use-nodes-sync-draft'
import { useWorkflowDraftGraphForCanvas } from '@/app/components/workflow-app/hooks/use-workflow-draft-graph-for-canvas'
import { HooksStoreContextProvider } from '@/app/components/workflow/hooks-store/provider'
import { useNodesInteractions } from '@/app/components/workflow/hooks/use-nodes-interactions'
import { NodeComponentMap } from '@/app/components/workflow/nodes/components'
import Panel from '@/app/components/workflow/nodes/panel'
import { useWorkflowStore } from '@/app/components/workflow/store/workflow'
import { BlockEnum } from '@/app/components/workflow/types'
import { initialEdges, initialNodes } from '@/app/components/workflow/utils'
import { isExternalAgentWorkflowPreviewData } from '../types'

// The Agent catalog entry routes external preview data before mounting Dify API owners.
const AgentNode = NodeComponentMap[BlockEnum.Agent] as unknown as ComponentType<{
  id: string
  data: ExternalAgentWorkflowPreviewNodeData
}>

function CanvasNode({ id, data }: NodeProps<CommonNodeType>) {
  return (
    <>
      <Handle type="target" position={Position.Left} />
      {isExternalAgentWorkflowPreviewData(data) ? (
        <AgentNode id={id} data={data} />
      ) : (
        <div>{data.title}</div>
      )}
      <Handle type="source" position={Position.Right} />
    </>
  )
}

const nodeTypes = { custom: CanvasNode }

function SelectedPanel() {
  // Match the workflow panel's getNodes subscription, including immediate picker updates.
  const node = useReactflow(
    useShallow((state) => {
      const selected = state.getNodes().find((node) => node.data.selected)
      return selected && { id: selected.id, type: selected.type, data: selected.data }
    }),
  )
  return node ? <Panel type={node.type} id={node.id} data={node.data} /> : null
}

export function ExternalAgentWorkflowCanvas({ graph }: { graph: WorkflowDataUpdater }) {
  const draft = useNodesSyncDraftByCanEdit(true)
  const workflowStore = useWorkflowStore()
  const { getWorkflowDraftGraphForCanvas } = useWorkflowDraftGraphForCanvas('workflow')
  const hydrated = getWorkflowDraftGraphForCanvas(graph)
  return (
    <HooksStoreContextProvider {...draft}>
      <button type="button" onClick={() => workflowStore.getState().flushPendingSync()}>
        Save workflow draft
      </button>
      <WorkflowCanvas graph={hydrated} />
    </HooksStoreContextProvider>
  )
}

function WorkflowCanvas({ graph }: { graph: WorkflowDataUpdater }) {
  const { handleNodeClick } = useNodesInteractions()
  return (
    <div className="isolate flex gap-4" style={{ height: 960 }}>
      <section aria-label="Agent canvas" style={{ width: 480, height: 960 }}>
        <ReactFlow
          defaultNodes={initialNodes(graph.nodes, graph.edges)}
          defaultEdges={initialEdges(graph.edges, graph.nodes)}
          defaultViewport={graph.viewport}
          nodeTypes={nodeTypes}
          onNodeClick={handleNodeClick}
          fitView
        />
      </section>
      <SelectedPanel />
    </div>
  )
}
