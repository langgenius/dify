import type { WorkflowDataUpdater } from '../types'
import type { WorkflowDataUpdateEvent } from '../workflow-data-update-event'
import { useCallback } from 'react'
import { useReactFlow } from 'reactflow'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { WORKFLOW_DATA_UPDATE } from '../constants'
import { useWorkflowStore } from '../store'
import { initialEdges, initialNodes } from '../utils'

export const useWorkflowUpdate = () => {
  const reactflow = useReactFlow()
  const { eventEmitter } = useEventEmitterContextContext()
  const workflowStore = useWorkflowStore()

  const handleUpdateWorkflowCanvas = useCallback(
    (payload: WorkflowDataUpdater) => {
      const { nodes, edges, viewport } = payload

      eventEmitter?.emit({
        type: WORKFLOW_DATA_UPDATE,
        payload: {
          target: workflowStore,
          nodes: initialNodes(nodes, edges),
          edges: initialEdges(edges, nodes),
        },
      } satisfies WorkflowDataUpdateEvent)

      if (
        viewport &&
        typeof viewport.x === 'number' &&
        typeof viewport.y === 'number' &&
        typeof viewport.zoom === 'number'
      )
        reactflow.setViewport(viewport)
    },
    [eventEmitter, reactflow, workflowStore],
  )

  return {
    handleUpdateWorkflowCanvas,
  }
}
