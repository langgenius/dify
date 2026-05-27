import type {
  FC,
} from 'react'
import type { PointerPosition } from './utils/pointer-position'
import type {
  Node,
} from '@/app/components/workflow/types'
import { useEventListener } from 'ahooks'
import { produce } from 'immer'
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  useReactFlow,
  useViewport,
} from 'reactflow'
import { useCollaborativeWorkflow } from '@/app/components/workflow/hooks/use-collaborative-workflow'
import { CUSTOM_NODE } from './constants'
import { useAutoGenerateWebhookUrl, useNodesInteractions, useNodesSyncDraft, useWorkflowHistory, WorkflowHistoryEvent } from './hooks'
import CustomNode from './nodes'
import CustomNoteNode from './note-node'
import { CUSTOM_NOTE_NODE } from './note-node/constants'
import {
  useWorkflowStore,
} from './store'
import { BlockEnum } from './types'
import { getIterationStartNode, getLoopStartNode } from './utils'
import { getPointerPositionFromEvent } from './utils/pointer-position'

type Props = {
  candidateNode: Node
}
const CandidateNodeMain: FC<Props> = ({
  candidateNode,
}) => {
  const reactflow = useReactFlow()
  const workflowStore = useWorkflowStore()
  const { zoom } = useViewport()
  const { handleNodeSelect } = useNodesInteractions()
  const { saveStateToHistory } = useWorkflowHistory()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const autoGenerateWebhookUrl = useAutoGenerateWebhookUrl()
  const collaborativeWorkflow = useCollaborativeWorkflow()
  const [pointerPosition, setPointerPosition] = useState<PointerPosition>(() => workflowStore.getState().getPointerPosition())
  const latestPointerPositionRef = useRef(pointerPosition)
  const pointerPositionFrameRef = useRef<number | undefined>(undefined)

  const schedulePointerPositionUpdate = useCallback((position: PointerPosition) => {
    latestPointerPositionRef.current = position
    if (pointerPositionFrameRef.current)
      return

    pointerPositionFrameRef.current = requestAnimationFrame(() => {
      pointerPositionFrameRef.current = undefined
      setPointerPosition(latestPointerPositionRef.current)
    })
  }, [])

  useEffect(() => {
    return () => {
      if (pointerPositionFrameRef.current) {
        cancelAnimationFrame(pointerPositionFrameRef.current)
        pointerPositionFrameRef.current = undefined
      }
    }
  }, [])

  useEventListener('mousemove', (e) => {
    const position = getPointerPositionFromEvent(e, document.getElementById('workflow-container'))
    workflowStore.getState().setPointerPosition(position)
    schedulePointerPositionUpdate(position)
  })

  useEventListener('click', (e) => {
    e.preventDefault()
    const clickPosition = getPointerPositionFromEvent(e, document.getElementById('workflow-container'))
    workflowStore.getState().setPointerPosition(clickPosition)
    const { screenToFlowPosition } = reactflow
    const { nodes, setNodes } = collaborativeWorkflow.getState()
    const { x, y } = screenToFlowPosition({ x: clickPosition.pageX, y: clickPosition.pageY })
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
    })
    setNodes(newNodes)
    if (candidateNode.type === CUSTOM_NOTE_NODE)
      saveStateToHistory(WorkflowHistoryEvent.NoteAdd, { nodeId: candidateNode.id })
    else
      saveStateToHistory(WorkflowHistoryEvent.NodeAdd, { nodeId: candidateNode.id })

    workflowStore.setState({ candidateNode: undefined })

    if (candidateNode.type === CUSTOM_NOTE_NODE)
      handleNodeSelect(candidateNode.id)

    if (candidateNode.data.type === BlockEnum.TriggerWebhook) {
      handleSyncWorkflowDraft(true, true, {
        onSuccess: () => autoGenerateWebhookUrl(candidateNode.id),
      })
    }
  })

  useEventListener('contextmenu', (e) => {
    e.preventDefault()
    workflowStore.setState({ candidateNode: undefined })
  })

  return (
    <div
      className="absolute z-10"
      style={{
        left: pointerPosition.elementX,
        top: pointerPosition.elementY,
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

export default memo(CandidateNodeMain)
