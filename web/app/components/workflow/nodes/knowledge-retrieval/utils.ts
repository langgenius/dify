import {
  uniq,
  xorBy,
} from 'lodash-es'
import type { MultipleRetrievalConfig } from './types'
import type {
  DataSet,
  SelectedDatasetsMode,
} from '@/models/datasets'
import {
  DEFAULT_WEIGHTED_SCORE,
  RerankingModeEnum,
} from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import { DATASET_DEFAULT } from '@/config'

export const checkNodeValid = () => {
  return true
}

export const getSelectedDatasetsMode = (datasets: DataSet[] = []) => {
  if (datasets === null)
    datasets = []
  let allHighQuality = true
  let allHighQualityVectorSearch = true
  let allHighQualityFullTextSearch = true
  let allEconomic = true
  let mixtureHighQualityAndEconomic = true
  let allExternal = true
  let allInternal = true
  let mixtureInternalAndExternal = true
  let inconsistentEmbeddingModel = false
  if (!datasets.length) {
    allHighQuality = false
    allHighQualityVectorSearch = false
    allHighQualityFullTextSearch = false
    allEconomic = false
    mixtureHighQualityAndEconomic = false
    inconsistentEmbeddingModel = false
    allExternal = false
    allInternal = false
    mixtureInternalAndExternal = false
  }
  datasets.forEach((dataset) => {
    if (dataset.indexing_technique === 'economy') {
      allHighQuality = false
      allHighQualityVectorSearch = false
      allHighQualityFullTextSearch = false
    }
    if (dataset.indexing_technique === 'high_quality') {
      allEconomic = false

      if (dataset.retrieval_model_dict.search_method !== RETRIEVE_METHOD.semantic)
        allHighQualityVectorSearch = false

      if (dataset.retrieval_model_dict.search_method !== RETRIEVE_METHOD.fullText)
        allHighQualityFullTextSearch = false
    }
    if (dataset.provider !== 'external') {
      allExternal = false
    }
    else {
      allInternal = false
      allHighQuality = false
      allHighQualityVectorSearch = false
      allHighQualityFullTextSearch = false
      mixtureHighQualityAndEconomic = false
    }
  })

  if (allExternal || allInternal)
    mixtureInternalAndExternal = false

  if (allHighQuality || allEconomic)
    mixtureHighQualityAndEconomic = false

  if (allHighQuality)
    inconsistentEmbeddingModel = uniq(datasets.map(item => item.embedding_model)).length > 1

  return {
    allHighQuality,
    allHighQualityVectorSearch,
    allHighQualityFullTextSearch,
    allEconomic,
    mixtureHighQualityAndEconomic,
    allInternal,
    allExternal,
    mixtureInternalAndExternal,
    inconsistentEmbeddingModel,
  } as SelectedDatasetsMode
}

export const getMultipleRetrievalConfig = (
  multipleRetrievalConfig: MultipleRetrievalConfig,
  selectedDatasets: DataSet[],
  originalDatasets: DataSet[],
  validRerankModel?: { provider?: string; model?: string },
) => {
  const shouldSetWeightDefaultValue = xorBy(selectedDatasets, originalDatasets, 'id').length > 0
  const rerankModelIsValid = validRerankModel?.provider && validRerankModel?.model

  const {
    allHighQuality,
    allHighQualityVectorSearch,
    allHighQualityFullTextSearch,
    allEconomic,
    mixtureHighQualityAndEconomic,
    allInternal,
    allExternal,
    mixtureInternalAndExternal,
    inconsistentEmbeddingModel,
  } = getSelectedDatasetsMode(selectedDatasets)

  const {
    top_k = DATASET_DEFAULT.top_k,
    score_threshold,
    reranking_mode,
    reranking_model,
    weights,
    reranking_enable,
  } = multipleRetrievalConfig || { top_k: DATASET_DEFAULT.top_k }

  const result = {
    top_k,
    score_threshold,
    reranking_mode,
    reranking_model,
    weights,
    reranking_enable: ((allInternal && allEconomic) || allExternal) ? reranking_enable : shouldSetWeightDefaultValue,
  }

  const setDefaultWeights = () => {
    result.weights = {
      vector_setting: {
        vector_weight: allHighQualityVectorSearch
          ? DEFAULT_WEIGHTED_SCORE.allHighQualityVectorSearch.semantic
          : allHighQualityFullTextSearch
            ? DEFAULT_WEIGHTED_SCORE.allHighQualityFullTextSearch.semantic
            : DEFAULT_WEIGHTED_SCORE.other.semantic,
        embedding_provider_name: selectedDatasets[0].embedding_model_provider,
        embedding_model_name: selectedDatasets[0].embedding_model,
      },
      keyword_setting: {
        keyword_weight: allHighQualityVectorSearch
          ? DEFAULT_WEIGHTED_SCORE.allHighQualityVectorSearch.keyword
          : allHighQualityFullTextSearch
            ? DEFAULT_WEIGHTED_SCORE.allHighQualityFullTextSearch.keyword
            : DEFAULT_WEIGHTED_SCORE.other.keyword,
      },
    }
  }

  if (allEconomic || mixtureHighQualityAndEconomic || inconsistentEmbeddingModel || allExternal || mixtureInternalAndExternal) {
    result.reranking_mode = RerankingModeEnum.RerankingModel
    if (!result.reranking_model?.provider || !result.reranking_model?.model) {
      if (rerankModelIsValid) {
        result.reranking_enable = true
        result.reranking_model = {
          provider: validRerankModel?.provider || '',
          model: validRerankModel?.model || '',
        }
      }
      else {
        result.reranking_model = {
          provider: '',
          model: '',
        }
      }
    }
    else {
      result.reranking_enable = true
    }
  }

  if (allHighQuality && !inconsistentEmbeddingModel && allInternal) {
    if (!reranking_mode) {
      if (validRerankModel?.provider && validRerankModel?.model) {
        result.reranking_mode = RerankingModeEnum.RerankingModel
        result.reranking_enable = true
        result.reranking_model = {
          provider: validRerankModel.provider,
          model: validRerankModel.model,
        }
      }
      else {
        result.reranking_mode = RerankingModeEnum.WeightedScore
        setDefaultWeights()
      }
    }

    if (reranking_mode === RerankingModeEnum.WeightedScore && !weights)
      setDefaultWeights()

    if (reranking_mode === RerankingModeEnum.WeightedScore && weights && shouldSetWeightDefaultValue) {
      if (rerankModelIsValid) {
        result.reranking_mode = RerankingModeEnum.RerankingModel
        result.reranking_enable = true
        result.reranking_model = {
          provider: validRerankModel.provider || '',
          model: validRerankModel.model || '',
        }
      }
      else {
        setDefaultWeights()
      }
    }
    if (reranking_mode === RerankingModeEnum.RerankingModel && !rerankModelIsValid && shouldSetWeightDefaultValue) {
      result.reranking_mode = RerankingModeEnum.WeightedScore
      setDefaultWeights()
    }
  }

  return result
}

export const checkoutRerankModelConfigedInRetrievalSettings = (
  datasets: DataSet[],
  multipleRetrievalConfig?: MultipleRetrievalConfig,
) => {
  if (!multipleRetrievalConfig)
    return true

  const {
    allEconomic,
    allExternal,
  } = getSelectedDatasetsMode(datasets)

  const {
    reranking_enable,
    reranking_mode,
    reranking_model,
  } = multipleRetrievalConfig

  if (reranking_mode === RerankingModeEnum.RerankingModel && (!reranking_model?.provider || !reranking_model?.model)) {
    if ((allEconomic || allExternal) && !reranking_enable)
      return true

    return false
  }

  return true
}
