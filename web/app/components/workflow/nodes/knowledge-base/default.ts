import type { NodeDefault } from '../../types'
import type { KnowledgeBaseNodeType } from './types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { BlockEnum } from '@/app/components/workflow/types'

const metaData = genNodeMetaData({
  sort: 3.1,
  type: BlockEnum.KnowledgeBase,
})
const nodeDefault: NodeDefault<KnowledgeBaseNodeType> = {
  metaData,
  defaultValue: {
    index_chunk_variable_selector: [],
    keyword_number: 10,
    retrieval_model: {
      top_k: 2,
      score_threshold_enabled: false,
      score_threshold: 0.5,
    },
  },
  checkValid(payload) {
    const { chunk_structure } = payload
    let errorMessage = ''

    if (!chunk_structure)
      errorMessage = 'Chunk structure is required.'

    return {
      isValid: !errorMessage,
      errorMessage,
    }
  },
}

export default nodeDefault
