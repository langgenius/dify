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
      _embeddingModelList,
      _rerankModelList,
    } = payload

    const {
      search_method,
      reranking_enable,
      reranking_model,
    } = retrieval_model || {}

    const currentEmbeddingModelProvider = _embeddingModelList?.find(provider => provider.provider === embedding_model_provider)
    const currentEmbeddingModel = currentEmbeddingModelProvider?.models.find(model => model.model === embedding_model)

    const currentRerankingModelProvider = _rerankModelList?.find(provider => provider.provider === reranking_model?.reranking_provider_name)
    const currentRerankingModel = currentRerankingModelProvider?.models.find(model => model.model === reranking_model?.reranking_model_name)

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

    if (indexing_technique === IndexingType.QUALIFIED) {
      if (!embedding_model || !embedding_model_provider) {
        return {
          isValid: false,
          errorMessage: t('workflow.nodes.knowledgeBase.embeddingModelIsRequired'),
        }
      }
      else if (!currentEmbeddingModel) {
        return {
          isValid: false,
          errorMessage: t('workflow.nodes.knowledgeBase.embeddingModelIsInvalid'),
        }
      }
    }

    if (!retrieval_model || !search_method) {
      return {
        isValid: false,
        errorMessage: t('workflow.nodes.knowledgeBase.retrievalSettingIsRequired'),
      }
    }

    if (reranking_enable) {
      if (!reranking_model || !reranking_model.reranking_provider_name || !reranking_model.reranking_model_name) {
        return {
          isValid: false,
          errorMessage: t('workflow.nodes.knowledgeBase.rerankingModelIsRequired'),
        }
      }
      else if (!currentRerankingModel) {
        return {
          isValid: false,
          errorMessage: t('workflow.nodes.knowledgeBase.rerankingModelIsInvalid'),
        }
      }
    }

    return {
      isValid: true,
      errorMessage: '',
    }
  },
}

export default nodeDefault
