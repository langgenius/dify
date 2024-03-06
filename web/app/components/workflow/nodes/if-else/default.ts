import type { NodeDefault } from '../../types'
import { type IfElseNodeType, LogicalOperator } from './types'

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
  getAvailablePrevNodes() {
    return []
  },
  getAvailableNextNodes() {
    return []
  },
}

export default nodeDefault
