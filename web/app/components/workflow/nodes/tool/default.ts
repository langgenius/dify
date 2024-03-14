import type { NodeDefault } from '../../types'
import type { ToolNodeType } from './types'

const nodeDefault: NodeDefault<ToolNodeType> = {
  defaultValue: {
    tool_parameters: [],
    tool_configurations: {},
  },
  getAvailablePrevNodes() {
    return []
  },
  getAvailableNextNodes() {
    return []
  },
}

export default nodeDefault
