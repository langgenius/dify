import type { WorkflowDataUpdater } from '../types'
import { useCallback } from 'react'
import { useReactFlow } from 'reactflow'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { WORKFLOW_DATA_UPDATE } from '../constants'
import {
  initialEdges,
  initialNodes,
} from '../utils'

export const useWorkflowUpdate = () => {
  const reactflow = useReactFlow()
  const { eventEmitter } = useEventEmitterContextContext()

  const handleUpdateWorkflowCanvas = useCallback((payload: WorkflowDataUpdater) => {
    const {
      nodes,
      edges,
      viewport,
    } = payload

    eventEmitter?.emit({
      type: WORKFLOW_DATA_UPDATE,
      payload: {
        nodes: initialNodes(nodes, edges),
        edges: initialEdges(edges, nodes),
      },
    } as never)

    if (viewport && typeof viewport.x === 'number' && typeof viewport.y === 'number' && typeof viewport.zoom === 'number')
      reactflow.setViewport(viewport)
  }, [eventEmitter, reactflow])

  return {
    handleUpdateWorkflowCanvas,
  }
}
