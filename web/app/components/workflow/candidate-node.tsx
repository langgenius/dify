import {
  memo,
} from 'react'
import { produce } from 'immer'
import {
  useReactFlow,
  useStoreApi,
  useViewport,
} from 'reactflow'
import { useEventListener } from 'ahooks'
import {
  useStore,
  useWorkflowStore,
} from './store'
import { WorkflowHistoryEvent, useNodesInteractions, useWorkflowHistory } from './hooks'
import { CUSTOM_NODE, ITERATION_PADDING } from './constants'
import { getIterationStartNode, getLoopStartNode } from './utils'
import CustomNode from './nodes'
import CustomNoteNode from './note-node'
import { CUSTOM_NOTE_NODE } from './note-node/constants'
import { BlockEnum } from './types'

const CandidateNode = () => {
  const store = useStoreApi()
  const reactflow = useReactFlow()
  const workflowStore = useWorkflowStore()
  const candidateNode = useStore(s => s.candidateNode)
  const mousePosition = useStore(s => s.mousePosition)
  const { zoom } = useViewport()
  const { handleNodeSelect } = useNodesInteractions()
  const { saveStateToHistory } = useWorkflowHistory()

  useEventListener('click', (e) => {
    const { candidateNode, mousePosition } = workflowStore.getState()

    if (candidateNode) {
      e.preventDefault()
      const {
        getNodes,
        setNodes,
      } = store.getState()
      const { screenToFlowPosition } = reactflow
      const nodes = getNodes()
      // Get mouse position in flow coordinates (this is where the top-left corner should be)
      let { x, y } = screenToFlowPosition({ x: mousePosition.pageX, y: mousePosition.pageY })

      // If the node has a parent (e.g., inside iteration), apply constraints and convert to relative position
      if (candidateNode.parentId) {
        const parentNode = nodes.find(node => node.id === candidateNode.parentId)
        if (parentNode && parentNode.position) {
          // Apply boundary constraints for iteration nodes
          if (candidateNode.data.isInIteration) {
            const nodeWidth = candidateNode.width || 0
            const nodeHeight = candidateNode.height || 0
            const minX = parentNode.position.x + ITERATION_PADDING.left
            const maxX = parentNode.position.x + (parentNode.width || 0) - ITERATION_PADDING.right - nodeWidth
            const minY = parentNode.position.y + ITERATION_PADDING.top
            const maxY = parentNode.position.y + (parentNode.height || 0) - ITERATION_PADDING.bottom - nodeHeight

            // Constrain position
            x = Math.max(minX, Math.min(maxX, x))
            y = Math.max(minY, Math.min(maxY, y))
          }

          // Convert to relative position
          x = x - parentNode.position.x
          y = y - parentNode.position.y
        }
      }

      const newNodes = produce(nodes, (draft) => {
        draft.push({
          ...candidateNode,
          data: {
            ...candidateNode.data,
            _isCandidate: false,
          },
          position: {
            x,
            y,
          },
        })
        if (candidateNode.data.type === BlockEnum.Iteration)
          draft.push(getIterationStartNode(candidateNode.id))

        if (candidateNode.data.type === BlockEnum.Loop)
          draft.push(getLoopStartNode(candidateNode.id))

        // Update parent iteration node's _children array
        if (candidateNode.parentId && candidateNode.data.isInIteration) {
          const parentNode = draft.find(node => node.id === candidateNode.parentId)
          if (parentNode && parentNode.data.type === BlockEnum.Iteration) {
            if (!parentNode.data._children)
              parentNode.data._children = []

            parentNode.data._children.push({
              nodeId: candidateNode.id,
              nodeType: candidateNode.data.type,
            })
          }
        }
      })
      setNodes(newNodes)
      if (candidateNode.type === CUSTOM_NOTE_NODE)
        saveStateToHistory(WorkflowHistoryEvent.NoteAdd, { nodeId: candidateNode.id })
      else
        saveStateToHistory(WorkflowHistoryEvent.NodeAdd, { nodeId: candidateNode.id })

      workflowStore.setState({ candidateNode: undefined })

      if (candidateNode.type === CUSTOM_NOTE_NODE)
        handleNodeSelect(candidateNode.id)
    }
  })

  useEventListener('contextmenu', (e) => {
    const { candidateNode } = workflowStore.getState()
    if (candidateNode) {
      e.preventDefault()
      workflowStore.setState({ candidateNode: undefined })
    }
  })

  if (!candidateNode)
    return null

  // Apply boundary constraints if node is inside iteration
  if (candidateNode.parentId && candidateNode.data.isInIteration) {
    const { getNodes } = store.getState()
    const nodes = getNodes()
    const parentNode = nodes.find(node => node.id === candidateNode.parentId)

    if (parentNode && parentNode.position) {
      const { screenToFlowPosition, flowToScreenPosition } = reactflow
      // Get mouse position in flow coordinates
      const flowPosition = screenToFlowPosition({ x: mousePosition.pageX, y: mousePosition.pageY })

      // Calculate boundaries in flow coordinates
      const nodeWidth = candidateNode.width || 0
      const nodeHeight = candidateNode.height || 0
      const minX = parentNode.position.x + ITERATION_PADDING.left
      const maxX = parentNode.position.x + (parentNode.width || 0) - ITERATION_PADDING.right - nodeWidth
      const minY = parentNode.position.y + ITERATION_PADDING.top
      const maxY = parentNode.position.y + (parentNode.height || 0) - ITERATION_PADDING.bottom - nodeHeight

      // Constrain position
      const constrainedX = Math.max(minX, Math.min(maxX, flowPosition.x))
      const constrainedY = Math.max(minY, Math.min(maxY, flowPosition.y))

      // Convert back to screen coordinates
      flowToScreenPosition({ x: constrainedX, y: constrainedY })
    }
  }

  return (
    <div
      className='absolute z-10'
      style={{
        left: mousePosition.elementX,
        top: mousePosition.elementY,
        transform: `scale(${zoom})`,
        transformOrigin: '0 0',
      }}
    >
      {
        candidateNode.type === CUSTOM_NODE && (
          <CustomNode {...candidateNode as any} />
        )
      }
      {
        candidateNode.type === CUSTOM_NOTE_NODE && (
          <CustomNoteNode {...candidateNode as any} />
        )
      }
    </div>
  )
}

export default memo(CandidateNode)
