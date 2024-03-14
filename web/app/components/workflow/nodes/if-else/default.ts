import type { NodeDefault } from '../../types'
import { type IfElseNodeType, LogicalOperator } from './types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/constants'

const nodeDefault: NodeDefault<IfElseNodeType> = {
  defaultValue: {
    _targetBranches: [
      {
        id: 'true',
        name: 'IS TRUE',
      },
      {
        id: 'false',
        name: 'IS FALSE',
      },
    ],
    logical_operator: LogicalOperator.and,
    conditions: [],
  },
  getAvailablePrevNodes(isChatMode: boolean) {
    const nodes = isChatMode ? ALL_CHAT_AVAILABLE_BLOCKS : ALL_COMPLETION_AVAILABLE_BLOCKS
    return nodes
  },
  getAvailableNextNodes(isChatMode: boolean) {
    const nodes = isChatMode ? ALL_CHAT_AVAILABLE_BLOCKS : ALL_COMPLETION_AVAILABLE_BLOCKS
    return nodes
  },
}

export default nodeDefault
