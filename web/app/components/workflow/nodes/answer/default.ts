import type { NodeDefault } from '../../types'
import type { AnswerNodeType } from './types'

const nodeDefault: NodeDefault<AnswerNodeType> = {
  defaultValue: {
    variables: [],
    answer: '',
  },
  getAvailablePrevNodes() {
    return []
  },
  getAvailableNextNodes() {
    return []
  },
}

export default nodeDefault
