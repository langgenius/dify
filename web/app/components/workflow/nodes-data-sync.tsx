import type { Node } from './types'
import { isEqual } from 'es-toolkit/predicate'
import { memo, useEffect } from 'react'
import { useStoreApi } from 'reactflow'
import { useWorkflowStore } from './store/workflow'

// Position changes belong to ReactFlow. Consumers of this store only need node content.
const WorkflowNodesDataSync = memo(() => {
  const reactFlowStore = useStoreApi()
  const workflowStore = useWorkflowStore()

  useEffect(() => {
    const syncNodeData = () => {
      const nodes = reactFlowStore.getState().getNodes() as Node[]
      const { nodes: previousNodes, setNodes } = workflowStore.getState()
      const changed =
        nodes.length !== previousNodes.length ||
        nodes.some((node, index) => {
          const previousNode = previousNodes[index]!
          return (
            node.id !== previousNode.id ||
            (node.data !== previousNode.data && !isEqual(node.data, previousNode.data))
          )
        })

      if (changed) setNodes(nodes)
    }

    syncNodeData()
    return reactFlowStore.subscribe((state, previousState) => {
      if (state.nodeInternals !== previousState.nodeInternals) syncNodeData()
    })
  }, [reactFlowStore, workflowStore])

  return null
})

export default WorkflowNodesDataSync
