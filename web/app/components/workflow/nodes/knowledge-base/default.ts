import type { NodeDefault } from '../../types'
import type { KnowledgeBaseNodeType } from './types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { BlockEnum } from '@/app/components/workflow/types'
import { IndexingType } from '@/app/components/datasets/create/step-two'

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
      embedding_model,
      embedding_model_provider,
      index_chunk_variable_selector,
    } = payload

    const {
      search_method,
      reranking_enable,
      reranking_model,
    } = retrieval_model || {}

    if (!chunk_structure) {
      return {
        isValid: false,
        errorMessage: t('workflow.nodes.knowledgeBase.chunkIsRequired'),
      }
    }

    if (index_chunk_variable_selector.length === 0) {
      return {
        isValid: false,
        errorMessage: t('workflow.nodes.knowledgeBase.chunksVariableIsRequired'),
      }
    }

    if (!indexing_technique) {
      return {
        isValid: false,
        errorMessage: t('workflow.nodes.knowledgeBase.indexMethodIsRequired'),
      }
    }

    if (indexing_technique === IndexingType.QUALIFIED && (!embedding_model || !embedding_model_provider)) {
      return {
        isValid: false,
        errorMessage: t('workflow.nodes.knowledgeBase.embeddingModelIsRequired'),
      }
    }

    if (!retrieval_model || !search_method) {
      return {
        isValid: false,
        errorMessage: t('workflow.nodes.knowledgeBase.retrievalSettingIsRequired'),
      }
    }

    if (reranking_enable && (!reranking_model || !reranking_model.reranking_provider_name || !reranking_model.reranking_model_name)) {
      return {
        isValid: false,
        errorMessage: t('workflow.nodes.knowledgeBase.rerankingModelIsRequired'),
      }
    }

    return {
      isValid: true,
      errorMessage: '',
    }
  },
}

export default nodeDefault
