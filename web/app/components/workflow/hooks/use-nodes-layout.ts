import { useCallback } from 'react'
import ELK from 'elkjs/lib/elk.bundled.js'
import {
  useReactFlow,
  useStoreApi,
} from 'reactflow'
import { cloneDeep } from 'lodash-es'
import type {
  Edge,
  Node,
} from '../types'
import { useWorkflowStore } from '../store'
import { AUTO_LAYOUT_OFFSET } from '../constants'
import { useNodesSyncDraft } from './use-nodes-sync-draft'

const layoutOptions = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.layered.spacing.nodeNodeBetweenLayers': '60',
  'elk.spacing.nodeNode': '40',
  'elk.layered.nodePlacement.strategy': 'SIMPLE',
}

const elk = new ELK()

export const getLayoutedNodes = async (nodes: Node[], edges: Edge[]) => {
  const graph = {
    id: 'root',
    layoutOptions,
    children: nodes.map((n) => {
      return {
        ...n,
        width: n.width ?? 150,
        height: n.height ?? 50,
        targetPosition: 'left',
        sourcePosition: 'right',
      }
    }),
    edges: cloneDeep(edges),
  }

  const layoutedGraph = await elk.layout(graph as any)
  const layoutedNodes = nodes.map((node) => {
    const layoutedNode = layoutedGraph.children?.find(
      lgNode => lgNode.id === node.id,
    )

    return {
      ...node,
      position: {
        x: (layoutedNode?.x ?? 0) + AUTO_LAYOUT_OFFSET.x,
        y: (layoutedNode?.y ?? 0) + AUTO_LAYOUT_OFFSET.y,
      },
    }
  })

  return {
    layoutedNodes,
  }
}

export const useNodesLayout = () => {
  const store = useStoreApi()
  const reactflow = useReactFlow()
  const workflowStore = useWorkflowStore()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()

  const handleNodesLayout = useCallback(async () => {
    workflowStore.setState({ nodeAnimation: true })
    const {
      getNodes,
      edges,
      setNodes,
    } = store.getState()
    const { setViewport } = reactflow
    const nodes = getNodes()
    const {
      layoutedNodes,
    } = await getLayoutedNodes(nodes, edges)

    setNodes(layoutedNodes)
    const zoom = 0.7
    setViewport({
      x: 0,
      y: 0,
      zoom,
    })
    setTimeout(() => {
      handleSyncWorkflowDraft()
    })
  }, [store, reactflow, handleSyncWorkflowDraft, workflowStore])

  return {
    handleNodesLayout,
  }
}
