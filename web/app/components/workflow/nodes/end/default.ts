import type { NodeDefault } from '../../types'
import { type EndNodeType, EndVarType } from './types'

const nodeDefault: NodeDefault<EndNodeType> = {
  defaultValue: {
    outputs: {
      type: EndVarType.none,
      plain_text_selector: [],
      structured_variables: [],
    },
  },
  getAvailablePrevNodes() {
    return []
  },
  getAvailableNextNodes() {
    return []
  },
}

export default nodeDefault
