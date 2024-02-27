import type { NodeDefault } from '../../types'
import type { TemplateTransformNodeType } from './types'

const nodeDefault: NodeDefault<TemplateTransformNodeType> = {
  defaultValue: {},
  getAvailablePrevNodes() {
    return []
  },
  getAvailableNextNodes() {
    return []
  },
}

export default nodeDefault
