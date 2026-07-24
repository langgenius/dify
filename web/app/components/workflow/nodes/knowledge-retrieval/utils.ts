import type { MultipleRetrievalConfig } from './types'
import type {
  DataSet,
  SelectedDatasetsMode,
} from '@/models/datasets'
import { uniq } from 'es-toolkit/array'
import { xorBy } from 'es-toolkit/compat'
import { DATASET_DEFAULT } from '@/config'
import {
  DEFAULT_WEIGHTED_SCORE,
  RerankingModeEnum,
  WeightedScoreEnum,
} from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'

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
  fallbackRerankModel?: { provider?: string, model?: string }, // fallback rerank model
) => {
  // Check if the selected datasets are different from the original datasets
  const isDatasetsChanged = xorBy(selectedDatasets, originalDatasets, 'id').length > 0
  // Check if the rerank model is valid
  const isFallbackRerankModelValid = !!(fallbackRerankModel?.provider && fallbackRerankModel?.model)

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
    reranking_enable,
  }

  const setDefaultWeights = () => {
    result.weights = {
      weight_type: WeightedScoreEnum.Customized,
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

  /**
   * In this case, user can manually toggle reranking
   * So should keep the reranking_enable value
   * But the default reranking_model should be set
   */
  if ((allEconomic && allInternal) || allExternal) {
    result.reranking_mode = RerankingModeEnum.RerankingModel
    // Need to check if the reranking model should be set to default when first time initialized
    if ((!result.reranking_model?.provider || !result.reranking_model?.model) && isFallbackRerankModelValid) {
      result.reranking_model = {
        provider: fallbackRerankModel.provider || '',
        model: fallbackRerankModel.model || '',
      }
    }
    result.reranking_enable = reranking_enable
  }

  /**
   * In this case, reranking_enable must be true
   * And if rerank model is not set, should set the default rerank model
   */
  if (mixtureHighQualityAndEconomic || inconsistentEmbeddingModel || mixtureInternalAndExternal) {
    result.reranking_mode = RerankingModeEnum.RerankingModel
    // Need to check if the reranking model should be set to default when first time initialized
    if ((!result.reranking_model?.provider || !result.reranking_model?.model) && isFallbackRerankModelValid) {
      result.reranking_model = {
        provider: fallbackRerankModel.provider || '',
        model: fallbackRerankModel.model || '',
      }
    }
    result.reranking_enable = true
  }

  /**
   * In this case, user can choose to use weighted score or rerank model
   * But if the reranking_mode is not initialized, should set the default rerank model and reranking_enable to true
   * and set reranking_mode to reranking_model
   */
  if (allHighQuality && !inconsistentEmbeddingModel && allInternal) {
    // If not initialized, check if the default rerank model is valid
    if (!reranking_mode) {
      if (isFallbackRerankModelValid) {
        result.reranking_mode = RerankingModeEnum.RerankingModel
        result.reranking_enable = true

        result.reranking_model = {
          provider: fallbackRerankModel.provider || '',
          model: fallbackRerankModel.model || '',
        }
      }
      else {
        result.reranking_mode = RerankingModeEnum.WeightedScore
        result.reranking_enable = false
        setDefaultWeights()
      }
    }

    // After initialization, if datasets has no change, make sure the config has correct value
    if (reranking_mode === RerankingModeEnum.WeightedScore) {
      result.reranking_enable = false
      if (!weights)
        setDefaultWeights()
    }
    if (reranking_mode === RerankingModeEnum.RerankingModel) {
      if ((!result.reranking_model?.provider || !result.reranking_model?.model) && isFallbackRerankModelValid) {
        result.reranking_model = {
          provider: fallbackRerankModel.provider || '',
          model: fallbackRerankModel.model || '',
        }
      }
      result.reranking_enable = true
    }

    // Need to check if reranking_mode should be set to reranking_model when datasets changed
    if (reranking_mode === RerankingModeEnum.WeightedScore && weights && isDatasetsChanged) {
      if ((result.reranking_model?.provider && result.reranking_model?.model) || isFallbackRerankModelValid) {
        result.reranking_mode = RerankingModeEnum.RerankingModel
        result.reranking_enable = true

        if ((!result.reranking_model?.provider || !result.reranking_model?.model) && isFallbackRerankModelValid) {
          result.reranking_model = {
            provider: fallbackRerankModel.provider || '',
            model: fallbackRerankModel.model || '',
          }
        }
      }
      else {
        setDefaultWeights()
      }
    }
    // Need to switch to weighted score when reranking model is not valid and datasets changed
    if (
      reranking_mode === RerankingModeEnum.RerankingModel
      && (!result.reranking_model?.provider || !result.reranking_model?.model)
      && !isFallbackRerankModelValid
      && isDatasetsChanged
    ) {
      result.reranking_mode = RerankingModeEnum.WeightedScore
      result.reranking_enable = false
      setDefaultWeights()
    }
  }

  return result
}

export const checkoutRerankModelConfiguredInRetrievalSettings = (
  datasets: DataSet[],
  multipleRetrievalConfig?: MultipleRetrievalConfig,
) => {
  if (!multipleRetrievalConfig)
    return true

  const {
    allEconomic,
    allExternal,
    allInternal,
  } = getSelectedDatasetsMode(datasets)

  const {
    reranking_enable,
    reranking_mode,
    reranking_model,
  } = multipleRetrievalConfig

  if (reranking_mode === RerankingModeEnum.RerankingModel && (!reranking_model?.provider || !reranking_model?.model))
    return ((allEconomic && allInternal) || allExternal) && !reranking_enable

  return true
}
