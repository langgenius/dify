import type {
  ComponentProps,
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
  useViewport,
} from 'reactflow'
import { useCollaborativeWorkflow } from '@/app/components/workflow/hooks/use-collaborative-workflow'
import { CUSTOM_NODE } from './constants'
import { useAutoGenerateWebhookUrl, useNodesInteractions, useNodesSyncDraft, useWorkflowHistory, WorkflowHistoryEvent } from './hooks'
import CustomNode from './nodes'
import { useCreateInlineAgentBinding } from './nodes/agent-v2/hooks'
import { isAgentV2NodeData, needsInlineAgentBindingCreation } from './nodes/agent-v2/types'
import CustomNoteNode from './note-node'
import { CUSTOM_NOTE_NODE } from './note-node/constants'
import {
  useStore,
  useWorkflowStore,
} from './store'
import { BlockEnum } from './types'
import { getIterationStartNode, getLoopStartNode } from './utils'

type Props = Readonly<{
  candidateNode: Node
}>
const CandidateNodeMain: FC<Props> = ({
  candidateNode,
}) => {
  const reactflow = useReactFlow()
  const workflowStore = useWorkflowStore()
  const mousePosition = useStore(s => s.mousePosition)
  const { zoom } = useViewport()
  const { handleNodeSelect } = useNodesInteractions()
  const { saveStateToHistory } = useWorkflowHistory()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const autoGenerateWebhookUrl = useAutoGenerateWebhookUrl()
  const collaborativeWorkflow = useCollaborativeWorkflow()
  const { createInlineAgentBinding } = useCreateInlineAgentBinding()

  useEventListener('click', (e) => {
    e.preventDefault()
    const { screenToFlowPosition } = reactflow
    const { nodes, setNodes } = collaborativeWorkflow.getState()
    const { x, y } = screenToFlowPosition({ x: mousePosition.pageX, y: mousePosition.pageY })
    const shouldCreateInlineAgentBinding = isAgentV2NodeData(candidateNode.data) && needsInlineAgentBindingCreation(candidateNode.data)
    const newNodes = produce(nodes, (draft) => {
      if (shouldCreateInlineAgentBinding) {
        draft.forEach((node) => {
          node.data.selected = false
        })
      }
      draft.push({
        ...candidateNode,
        data: {
          ...candidateNode.data,
          _isCandidate: false,
          _isTempNode: shouldCreateInlineAgentBinding ? true : candidateNode.data._isTempNode,
          selected: shouldCreateInlineAgentBinding ? true : candidateNode.data.selected,
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

    if (shouldCreateInlineAgentBinding) {
      workflowStore.getState().setOpenInlineAgentPanelNodeId(candidateNode.id)
      createInlineAgentBinding(candidateNode.id, {
        onError: () => {
          const { nodes, setNodes } = collaborativeWorkflow.getState()
          setNodes(nodes.filter(node => node.id !== candidateNode.id))
        },
        onSuccess: (binding) => {
          const { nodes, setNodes } = collaborativeWorkflow.getState()
          setNodes(produce(nodes, (draft) => {
            const node = draft.find(node => node.id === candidateNode.id)
            if (node) {
              if (isAgentV2NodeData(node.data) && needsInlineAgentBindingCreation(node.data))
                node.data.agent_binding = binding
              node.data._openInlineAgentPanel = true
              delete node.data._isTempNode
            }
          }))
          handleSyncWorkflowDraft(true, true)
        },
      })
      return
    }

    if (isAgentV2NodeData(candidateNode.data))
      handleSyncWorkflowDraft(true, true)
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
          <CustomNode {...candidateNode as unknown as ComponentProps<typeof CustomNode>} />
        )
      }
      {
        candidateNode.type === CUSTOM_NOTE_NODE && (
          <CustomNoteNode {...candidateNode as unknown as ComponentProps<typeof CustomNoteNode>} />
        )
      }
    </div>
  )
}

export default memo(CandidateNodeMain)
