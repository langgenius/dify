import type { NodeDefault } from '../../types'
import type { KnowledgeBaseNodeType } from './types'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { BlockEnum } from '@/app/components/workflow/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'

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
        errorMessage: t('nodes.knowledgeBase.chunkIsRequired', { ns: 'workflow' }),
      }
    }

    if (index_chunk_variable_selector.length === 0) {
      return {
        isValid: false,
        errorMessage: t('nodes.knowledgeBase.chunksVariableIsRequired', { ns: 'workflow' }),
      }
    }

    if (!indexing_technique) {
      return {
        isValid: false,
        errorMessage: t('nodes.knowledgeBase.indexMethodIsRequired', { ns: 'workflow' }),
      }
    }

    if (indexing_technique === IndexingType.QUALIFIED) {
      if (!embedding_model || !embedding_model_provider) {
        return {
          isValid: false,
          errorMessage: t('nodes.knowledgeBase.embeddingModelIsRequired', { ns: 'workflow' }),
        }
      }
      else if (!currentEmbeddingModel) {
        return {
          isValid: false,
          errorMessage: t('nodes.knowledgeBase.embeddingModelIsInvalid', { ns: 'workflow' }),
        }
      }
    }

    if (!retrieval_model || !search_method) {
      return {
        isValid: false,
        errorMessage: t('nodes.knowledgeBase.retrievalSettingIsRequired', { ns: 'workflow' }),
      }
    }

    if (reranking_enable) {
      if (!reranking_model || !reranking_model.reranking_provider_name || !reranking_model.reranking_model_name) {
        return {
          isValid: false,
          errorMessage: t('nodes.knowledgeBase.rerankingModelIsRequired', { ns: 'workflow' }),
        }
      }
      else if (!currentRerankingModel) {
        return {
          isValid: false,
          errorMessage: t('nodes.knowledgeBase.rerankingModelIsInvalid', { ns: 'workflow' }),
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
