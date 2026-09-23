import type { ProviderWithModelsResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { RetrievalConfig } from '@/types/app'
import { RerankingModeEnum } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'

/**
 * Hybrid Search renders no rerank on/off switch, so `reranking_enable` is only ever written when
 * the retrieval method is switched. A dataset configured as "open -> pick rerank model -> save"
 * therefore keeps the stale `false` default and silently never reranks, even though the selected
 * model is displayed in the UI. In Hybrid Search a chosen rerank model is exactly what
 * `isReRankModelSelected` already validates, so derive the flag from the selection on save.
 */
export const normalizeRetrievalConfigForSave = (
  retrievalConfig: RetrievalConfig,
): RetrievalConfig => {
  if (
    retrievalConfig.search_method === RETRIEVE_METHOD.hybrid &&
    retrievalConfig.reranking_mode === RerankingModeEnum.RerankingModel &&
    retrievalConfig.reranking_model?.reranking_provider_name &&
    retrievalConfig.reranking_model?.reranking_model_name
  ) {
    return {
      ...retrievalConfig,
      reranking_enable: true,
    }
  }

  return retrievalConfig
}

export const isReRankModelSelected = ({
  retrievalConfig,
  rerankModelList,
  indexMethod,
}: {
  retrievalConfig: RetrievalConfig
  rerankModelList: ProviderWithModelsResponse[]
  indexMethod?: string
}) => {
  const rerankModelSelected = (() => {
    if (retrievalConfig.reranking_model?.reranking_model_name) {
      const provider = rerankModelList.find(
        ({ provider }) => provider === retrievalConfig.reranking_model?.reranking_provider_name,
      )

      return provider?.models.find(
        ({ model }) => model === retrievalConfig.reranking_model?.reranking_model_name,
      )
    }

    return false
  })()

  if (
    indexMethod === 'high_quality' &&
    [RETRIEVE_METHOD.semantic, RETRIEVE_METHOD.fullText].includes(retrievalConfig.search_method) &&
    retrievalConfig.reranking_enable &&
    !rerankModelSelected
  ) {
    return false
  }

  if (
    indexMethod === 'high_quality' &&
    retrievalConfig.search_method === RETRIEVE_METHOD.hybrid &&
    retrievalConfig.reranking_mode !== RerankingModeEnum.WeightedScore &&
    !rerankModelSelected
  ) {
    return false
  }

  return true
}
