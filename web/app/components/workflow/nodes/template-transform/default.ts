import type { NodeDefault } from '../../types'
import type { TemplateTransformNodeType } from './types'

const nodeDefault: NodeDefault<TemplateTransformNodeType> = {
  defaultValue: {
    variables: [],
  },
  getAvailablePrevNodes() {
    return []
  },
  getAvailableNextNodes() {
    return []
  },
}

export default nodeDefault
