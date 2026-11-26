import type { ComponentProps, FC } from 'react'
import type { Node } from '@/app/components/workflow/types'
import { useEventListener } from 'ahooks'
import { produce } from 'immer'
import { memo } from 'react'
import { useReactFlow, useViewport } from 'reactflow'
import { collaborationManager } from './collaboration/core/collaboration-manager'
import { CUSTOM_NODE } from './constants'
import { useAutoGenerateWebhookUrl } from './hooks/use-auto-generate-webhook-url'
import { useCollaborativeWorkflow } from './hooks/use-collaborative-workflow'
import { useNodesInteractions } from './hooks/use-nodes-interactions'
import { useNodesSyncDraft } from './hooks/use-nodes-sync-draft'
import { useWorkflowHistory, WorkflowHistoryEvent } from './hooks/use-workflow-history'
import CustomNode from './nodes'
import { isAgentV2NodeData, needsInlineAgentBindingCreation } from './nodes/agent-v2/types'
import CustomNoteNode from './note-node'
import { CUSTOM_NOTE_NODE } from './note-node/constants'
import { useStore, useWorkflowStore } from './store'
import { BlockEnum } from './types'
import { getIterationStartNode, getLoopStartNode } from './utils'

type Props = Readonly<{
  candidateNode: Node
}>
const CandidateNodeMain: FC<Props> = ({ candidateNode }) => {
  const reactflow = useReactFlow()
  const workflowStore = useWorkflowStore()
  const mousePosition = useStore((s) => s.mousePosition)
  const { zoom } = useViewport()
  const { handleNodeSelect, createInlineAgentBindingForNode } = useNodesInteractions()
  const { saveStateToHistory } = useWorkflowHistory()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const autoGenerateWebhookUrl = useAutoGenerateWebhookUrl()
  const collaborativeWorkflow = useCollaborativeWorkflow()

  useEventListener('click', (e) => {
    e.preventDefault()
    const { screenToFlowPosition } = reactflow
    const { nodes, setNodes } = collaborativeWorkflow.getState()
    const { x, y } = screenToFlowPosition({ x: mousePosition.pageX, y: mousePosition.pageY })
    const shouldCreateInlineAgentBinding =
      isAgentV2NodeData(candidateNode.data) && needsInlineAgentBindingCreation(candidateNode.data)
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

      if (candidateNode.data.type === BlockEnum.Loop) draft.push(getLoopStartNode(candidateNode.id))
    })
    const isNote = candidateNode.type === CUSTOM_NOTE_NODE
    const historyEvent = isNote ? WorkflowHistoryEvent.NoteAdd : WorkflowHistoryEvent.NodeAdd
    collaborationManager.runDraftHistoryAction(historyEvent, () => setNodes(newNodes))
    saveStateToHistory(historyEvent, { nodeId: candidateNode.id })

    workflowStore.setState({ candidateNode: undefined })

    if (isNote) handleNodeSelect(candidateNode.id)

    if (candidateNode.data.type === BlockEnum.TriggerWebhook) {
      handleSyncWorkflowDraft(true, true, {
        onSuccess: () => autoGenerateWebhookUrl(candidateNode.id),
      })
    }

    if (shouldCreateInlineAgentBinding) {
      createInlineAgentBindingForNode(candidateNode.id)
      return
    }

    if (isAgentV2NodeData(candidateNode.data)) handleSyncWorkflowDraft(true, true)
  })

  useEventListener('contextmenu', (e) => {
    e.preventDefault()
    workflowStore.setState({ candidateNode: undefined })
  })

  return (
    <div
      className="absolute"
      style={{
        left: mousePosition.elementX,
        top: mousePosition.elementY,
        transform: `scale(${zoom})`,
        transformOrigin: '0 0',
      }}
    >
      {candidateNode.type === CUSTOM_NODE && (
        <CustomNode {...(candidateNode as unknown as ComponentProps<typeof CustomNode>)} />
      )}
      {candidateNode.type === CUSTOM_NOTE_NODE && (
        <CustomNoteNode {...(candidateNode as unknown as ComponentProps<typeof CustomNoteNode>)} />
      )}
    </div>
  )
}

export default memo(CandidateNodeMain)
