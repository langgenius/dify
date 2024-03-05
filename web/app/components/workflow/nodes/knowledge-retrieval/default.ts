import type { NodeDefault } from '../../types'
import type { KnowledgeRetrievalNodeType } from './types'
import { RETRIEVE_TYPE } from '@/types/app'

const nodeDefault: NodeDefault<KnowledgeRetrievalNodeType> = {
  defaultValue: {
    query_variable_selector: [],
    dataset_ids: [],
    retrieval_mode: RETRIEVE_TYPE.oneWay,
  },
  getAvailablePrevNodes() {
    return []
  },
  getAvailableNextNodes() {
    return []
  },
}

export default nodeDefault
