import type { NodeDefault } from '../../types'
import type { DirectAnswerNodeType } from './types'

const nodeDefault: NodeDefault<DirectAnswerNodeType> = {
  defaultValue: {},
  getAvailablePrevNodes() {
    return []
  },
  getAvailableNextNodes() {
    return []
  },
}

export default nodeDefault
