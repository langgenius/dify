import type { NodeDefault } from '../../types'
import type { KnowledgeRetrievalNodeType } from './types'

const nodeDefault: NodeDefault<KnowledgeRetrievalNodeType> = {
  defaultValue: {},
  getAvailablePrevNodes() {
    return []
  },
  getAvailableNextNodes() {
    return []
  },
}

export default nodeDefault
