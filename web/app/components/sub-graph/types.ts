import type { StateCreator } from 'zustand'
import type { Shape as HooksStoreShape } from '@/app/components/workflow/hooks-store'
import type { NestedNodeConfig } from '@/app/components/workflow/nodes/_base/types'
import type { CodeNodeType } from '@/app/components/workflow/nodes/code/types'
import type { LLMNodeType } from '@/app/components/workflow/nodes/llm/types'
import type { BlockEnum, Edge, Node, NodeOutPutVar, ValueSelector } from '@/app/components/workflow/types'

export type SyncWorkflowDraftCallback = {
  onSuccess?: () => void
  onError?: () => void
  onSettled?: () => void
}

export type SyncWorkflowDraft = (
  notRefreshWhenSyncError?: boolean,
  callback?: SyncWorkflowDraftCallback,
) => Promise<void>

export type SubGraphVariant = 'agent' | 'assemble'

type BaseSubGraphProps = {
  toolNodeId: string
  paramKey: string
  configsMap?: HooksStoreShape['configsMap']
  toolParamValue?: string
  parentAvailableNodes?: Node[]
  parentAvailableVars?: NodeOutPutVar[]
  selectableNodeTypes?: BlockEnum[]
  onSave?: (nodes: Node[], edges: Edge[]) => void
  onSyncWorkflowDraft?: SyncWorkflowDraft
}

export type AgentSubGraphProps = BaseSubGraphProps & {
  variant: 'agent'
  sourceVariable: ValueSelector
  agentNodeId: string
  agentName: string
  nestedNodeConfig: NestedNodeConfig
  onNestedNodeConfigChange: (config: NestedNodeConfig) => void
  extractorNode?: Node<LLMNodeType>
}

export type AssembleSubGraphProps = BaseSubGraphProps & {
  variant: 'assemble'
  title: string
  nestedNodeConfig: NestedNodeConfig
  onNestedNodeConfigChange: (config: NestedNodeConfig) => void
  extractorNode?: Node<CodeNodeType>
}

export type SubGraphProps = AgentSubGraphProps | AssembleSubGraphProps

export type SubGraphSliceShape = {
  parentAvailableVars: NodeOutPutVar[]
  parentAvailableNodes: Node[]
  setParentAvailableVars: (vars: NodeOutPutVar[]) => void
  setParentAvailableNodes: (nodes: Node[]) => void
}

export type CreateSubGraphSlice = StateCreator<SubGraphSliceShape>
