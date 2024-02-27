import type { NodeDefault } from '../../types'
import type { VariableAssignerNodeType } from './types'

const nodeDefault: NodeDefault<VariableAssignerNodeType> = {
  defaultValue: {},
  getAvailablePrevNodes() {
    return []
  },
  getAvailableNextNodes() {
    return []
  },
}

export default nodeDefault
