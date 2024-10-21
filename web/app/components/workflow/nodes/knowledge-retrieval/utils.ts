import { uniq } from 'lodash-es'
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

export const getSelectedDatasetsMode = (datasets: DataSet[]) => {
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

export const getMultipleRetrievalConfig = (multipleRetrievalConfig: MultipleRetrievalConfig, selectedDatasets: DataSet[]) => {
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
    reranking_enable: ((allInternal && allEconomic) || allExternal) ? reranking_enable : true,
  }

  if (allEconomic || mixtureHighQualityAndEconomic || inconsistentEmbeddingModel || allExternal || mixtureInternalAndExternal)
    result.reranking_mode = RerankingModeEnum.RerankingModel

  if (allHighQuality && !inconsistentEmbeddingModel && reranking_mode === undefined && allInternal)
    result.reranking_mode = RerankingModeEnum.WeightedScore

  if (allHighQuality && !inconsistentEmbeddingModel && (reranking_mode === RerankingModeEnum.WeightedScore || reranking_mode === undefined) && allInternal && !weights) {
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

  return result
}
