import type { NodeDefault } from '../../types'
import type { CodeNodeType } from './types'

const nodeDefault: NodeDefault<CodeNodeType> = {
  defaultValue: {},
  getAvailablePrevNodes() {
    return []
  },
  getAvailableNextNodes() {
    return []
  },
}

export default nodeDefault
