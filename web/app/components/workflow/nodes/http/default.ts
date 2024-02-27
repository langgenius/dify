import type { NodeDefault } from '../../types'
import type { HttpNodeType } from './types'

const nodeDefault: NodeDefault<HttpNodeType> = {
  defaultValue: {},
  getAvailablePrevNodes() {
    return []
  },
  getAvailableNextNodes() {
    return []
  },
}

export default nodeDefault
