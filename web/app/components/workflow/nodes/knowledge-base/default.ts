import type { NodeDefault } from '../../types'
import type { KnowledgeBaseNodeType } from './types'
import {
  ChunkStructureEnum,
  HybridSearchModeEnum,
  IndexMethodEnum,
  RetrievalSearchMethodEnum,
} from './types'
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
    chunk_structure: ChunkStructureEnum.general,
    indexing_technique: IndexMethodEnum.QUALIFIED,
    keyword_number: 10,
    retrieval_model: {
      search_method: RetrievalSearchMethodEnum.hybrid,
      top_k: 2,
      score_threshold_enabled: false,
      score_threshold: 0.5,
      hybridSearchMode: HybridSearchModeEnum.WeightedScore,
    },
  },
  checkValid() {
    return {
      isValid: true,
      errorMessage: '',
    }
  },
}

export default nodeDefault
