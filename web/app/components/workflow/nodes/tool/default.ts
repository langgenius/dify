import type { NodeDefault } from '../../types'
import type { ToolNodeType } from './types'

const nodeDefault: NodeDefault<ToolNodeType> = {
  defaultValue: {
    tool_inputs: [],
    tool_parameters: {},
  },
  getAvailablePrevNodes() {
    return []
  },
  getAvailableNextNodes() {
    return []
  },
}

export default nodeDefault
