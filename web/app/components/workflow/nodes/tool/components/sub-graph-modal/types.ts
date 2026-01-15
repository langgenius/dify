import type { SyncWorkflowDraft } from '@/app/components/sub-graph/types'
import type { Shape as HooksStoreShape } from '@/app/components/workflow/hooks-store'
import type { MentionConfig } from '@/app/components/workflow/nodes/_base/types'
import type { LLMNodeType } from '@/app/components/workflow/nodes/llm/types'
import type { NodeOutPutVar, Edge as WorkflowEdge, Node as WorkflowNode } from '@/app/components/workflow/types'

type WorkflowValueSelector = string[]

export type SubGraphModalProps = {
  isOpen: boolean
  onClose: () => void
  toolNodeId: string
  paramKey: string
  sourceVariable: WorkflowValueSelector
  agentName: string
  agentNodeId: string
}

export type SubGraphCanvasProps = {
  toolNodeId: string
  paramKey: string
  sourceVariable: WorkflowValueSelector
  agentNodeId: string
  agentName: string
  configsMap?: HooksStoreShape['configsMap']
  mentionConfig: MentionConfig
  onMentionConfigChange: (config: MentionConfig) => void
  extractorNode?: WorkflowNode<LLMNodeType>
  toolParamValue?: string
  parentAvailableNodes?: WorkflowNode[]
  parentAvailableVars?: NodeOutPutVar[]
  onSave?: (nodes: WorkflowNode[], edges: WorkflowEdge[]) => void
  onSyncWorkflowDraft?: SyncWorkflowDraft
}
