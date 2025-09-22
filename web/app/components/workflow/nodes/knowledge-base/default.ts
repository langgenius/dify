import type { NodeDefault } from '../../types'
import type { KnowledgeBaseNodeType } from './types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { BlockEnum } from '@/app/components/workflow/types'

const metaData = genNodeMetaData({
  sort: 3.1,
  type: BlockEnum.KnowledgeBase,
  isRequired: true,
  isUndeletable: true,
  isSingleton: true,
  isTypeFixed: true,
})
const nodeDefault: NodeDefault<KnowledgeBaseNodeType> = {
  metaData,
  defaultValue: {
    index_chunk_variable_selector: [],
    keyword_number: 10,
    retrieval_model: {
      top_k: 3,
      score_threshold_enabled: false,
      score_threshold: 0.5,
    },
  },
  checkValid(payload, t) {
    const {
      chunk_structure,
      indexing_technique,
      retrieval_model,
    } = payload

    if (!chunk_structure) {
      return {
        isValid: false,
        errorMessage: t('workflow.nodes.knowledgeBase.chunkIsRequired'),
      }
    }

    if (!indexing_technique) {
      return {
        isValid: false,
        errorMessage: t('workflow.nodes.knowledgeBase.indexMethodIsRequired'),
      }
    }

    if (!retrieval_model || !retrieval_model.search_method) {
      return {
        isValid: false,
        errorMessage: t('workflow.nodes.knowledgeBase.retrievalSettingIsRequired'),
      }
    }

    return {
      isValid: true,
      errorMessage: '',
    }
  },
}

export default nodeDefault
