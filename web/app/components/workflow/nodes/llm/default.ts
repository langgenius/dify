import type { NodeDefault } from '../../types'
import type { LLMNodeType } from './types'

const nodeDefault: NodeDefault<LLMNodeType> = {
  defaultValue: {},
  getAvailablePrevNodes() {
    return []
  },
  getAvailableNextNodes() {
    return []
  },
}

export default nodeDefault
