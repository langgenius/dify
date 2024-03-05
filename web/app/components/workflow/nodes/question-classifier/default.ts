import type { NodeDefault } from '../../types'
import type { QuestionClassifierNodeType } from './types'

const nodeDefault: NodeDefault<QuestionClassifierNodeType> = {
  defaultValue: {
    query_variable_selector: [],
    model: {
      provider: '',
      name: '',
      mode: 'chat',
      completion_params: {
        temperature: 0.7,
      },
    },
    classes: [],
  },
  getAvailablePrevNodes() {
    return []
  },
  getAvailableNextNodes() {
    return []
  },
}

export default nodeDefault
