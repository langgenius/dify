import type { WorkflowDataUpdater } from '../types'
import type { FetchWorkflowDraftResponse } from '@/types/workflow'
import { useCallback } from 'react'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { WORKFLOW_DATA_UPDATE } from '../constants'
import { initialEdges, initialNodes } from '../utils'

export const useWorkflowUpdate = () => {
  const { eventEmitter } = useEventEmitterContextContext()

  const handleUpdateWorkflowCanvas = useCallback(
    (
      payload: WorkflowDataUpdater,
      options?: {
        syncToCollaboration?: boolean
        features?: FetchWorkflowDraftResponse['features']
      },
    ) => {
      const { nodes, edges, viewport } = payload
      let applied = false

      eventEmitter?.emit({
        type: WORKFLOW_DATA_UPDATE,
        payload: {
          nodes: initialNodes(nodes, edges),
          edges: initialEdges(edges, nodes),
          viewport:
            viewport &&
            typeof viewport.x === 'number' &&
            typeof viewport.y === 'number' &&
            typeof viewport.zoom === 'number'
              ? viewport
              : undefined,
          ...options,
          onApplied: () => {
            applied = true
          },
        },
      } as never)

      return applied
    },
    [eventEmitter],
  )

  return {
    handleUpdateWorkflowCanvas,
  }
}
