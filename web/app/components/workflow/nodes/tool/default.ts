import type { NodeDefault } from '../../types'
import type { ToolNodeType } from './types'

const nodeDefault: NodeDefault<ToolNodeType> = {
  defaultValue: {},
  getAvailablePrevNodes() {
    return []
  },
  getAvailableNextNodes() {
    return []
  },
}

export default nodeDefault
