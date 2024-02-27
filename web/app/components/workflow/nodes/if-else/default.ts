import type { NodeDefault } from '../../types'
import type { IfElseNodeType } from './types'

const nodeDefault: NodeDefault<IfElseNodeType> = {
  defaultValue: {},
  getAvailablePrevNodes() {
    return []
  },
  getAvailableNextNodes() {
    return []
  },
}

export default nodeDefault
