import type { WorkflowKind } from '@/types/workflow'
import { AppTypeEnum } from '@/types/app'
import { BlockEnum, TRIGGER_NODE_TYPES } from '../types'

const EVALUATION_WORKFLOW_RESTRICTED_NODE_TYPES = new Set<string>([
  BlockEnum.HumanInput,
  ...TRIGGER_NODE_TYPES,
])

export const isEvaluationWorkflow = (appType?: WorkflowKind | null) => appType === AppTypeEnum.EVALUATION

export const isEvaluationWorkflowRestrictedNodeType = (nodeType?: string) => {
  if (!nodeType)
    return false

  return EVALUATION_WORKFLOW_RESTRICTED_NODE_TYPES.has(nodeType)
}

export const filterEvaluationWorkflowRestrictedBlockTypes = (blockTypes: BlockEnum[]) => {
  return blockTypes.filter(blockType => !isEvaluationWorkflowRestrictedNodeType(blockType))
}
