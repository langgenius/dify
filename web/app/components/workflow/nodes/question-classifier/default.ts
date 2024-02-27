import type { NodeDefault } from '../../types'
import type { QuestionClassifierNodeType } from './types'

const nodeDefault: NodeDefault<QuestionClassifierNodeType> = {
  defaultValue: {},
  getAvailablePrevNodes() {
    return []
  },
  getAvailableNextNodes() {
    return []
  },
}

export default nodeDefault
