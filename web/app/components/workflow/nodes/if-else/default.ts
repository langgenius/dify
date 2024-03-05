import type { NodeDefault } from '../../types'
import { type IfElseNodeType, LogicalOperator } from './types'

const nodeDefault: NodeDefault<IfElseNodeType> = {
  defaultValue: {
    _targetBranches: [
      {
        id: 'if-true',
        name: 'IS TRUE',
      },
      {
        id: 'if-false',
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
