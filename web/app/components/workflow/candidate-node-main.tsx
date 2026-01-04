import type {
  FC,
} from 'react'
import type {
  Node,
} from '@/app/components/workflow/types'
import { useEventListener } from 'ahooks'
import { produce } from 'immer'
import {
  memo,
} from 'react'
import {
  useReactFlow,
  useStoreApi,
  useViewport,
} from 'reactflow'
import { CUSTOM_NODE } from './constants'
import { useAutoGenerateWebhookUrl, useNodesInteractions, useNodesSyncDraft, useWorkflowHistory, WorkflowHistoryEvent } from './hooks'
import CustomNode from './nodes'
import CustomNoteNode from './note-node'
import { CUSTOM_NOTE_NODE } from './note-node/constants'
import {
  useStore,
  useWorkflowStore,
} from './store'
import { BlockEnum } from './types'
import { getIterationStartNode, getLoopStartNode } from './utils'

type Props = {
  candidateNode: Node
}
const CandidateNodeMain: FC<Props> = ({
  candidateNode,
}) => {
  const store = useStoreApi()
  const reactflow = useReactFlow()
  const workflowStore = useWorkflowStore()
  const mousePosition = useStore(s => s.mousePosition)
  const { zoom } = useViewport()
  const { handleNodeSelect } = useNodesInteractions()
  const { saveStateToHistory } = useWorkflowHistory()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const autoGenerateWebhookUrl = useAutoGenerateWebhookUrl()

  useEventListener('click', (e) => {
    e.preventDefault()
    const {
      getNodes,
      setNodes,
    } = store.getState()
    const { screenToFlowPosition } = reactflow
    const nodes = getNodes()
    const { x, y } = screenToFlowPosition({ x: mousePosition.pageX, y: mousePosition.pageY })
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

export default memo(CandidateNodeMain)
