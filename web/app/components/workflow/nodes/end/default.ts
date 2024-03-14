import type { NodeDefault } from '../../types'
import { type EndNodeType } from './types'

const nodeDefault: NodeDefault<EndNodeType> = {
  defaultValue: {
    outputs: [],
  },
  getAvailablePrevNodes() {
    return []
  },
  getAvailableNextNodes() {
    return []
  },
}

export default nodeDefault
