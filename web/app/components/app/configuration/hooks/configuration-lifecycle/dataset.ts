import type { DataSet } from '@/models/datasets'
import type { DatasetConfigs } from '@/models/debug'
import type { ModelConfig as BackendModelConfig } from '@/types/app'
import { produce } from 'immer'
import { useMemo } from 'react'
import {
  getMultipleRetrievalConfig,
  getSelectedDatasetsMode,
} from '@/app/components/workflow/nodes/knowledge-retrieval/utils'
import { RETRIEVE_TYPE } from '@/types/app'
import { correctModelProvider } from '@/utils'

export function buildConfigurationDatasetConfigs({
  backendModelConfig,
  currentRerankModel,
  currentRerankProvider,
  nextDataSets,
}: {
  backendModelConfig: BackendModelConfig
  currentRerankModel?: string
  currentRerankProvider?: string
  nextDataSets: DataSet[]
}): DatasetConfigs {
  const retrievalConfig = getMultipleRetrievalConfig(
    {
      ...backendModelConfig.dataset_configs,
      reranking_model: backendModelConfig.dataset_configs.reranking_model && {
        provider: backendModelConfig.dataset_configs.reranking_model.reranking_provider_name,
        model: backendModelConfig.dataset_configs.reranking_model.reranking_model_name,
      },
    },
    nextDataSets,
    nextDataSets,
    {
      provider: currentRerankProvider,
      model: currentRerankModel,
    },
  )

  const nextDatasetConfigs = {
    ...backendModelConfig.dataset_configs,
    ...retrievalConfig,
    ...(retrievalConfig.reranking_model
      ? {
          reranking_model: {
            reranking_model_name: retrievalConfig.reranking_model.model,
            reranking_provider_name: correctModelProvider(retrievalConfig.reranking_model.provider),
          },
        }
      : {}),
  } as DatasetConfigs

  nextDatasetConfigs.retrieval_model = nextDatasetConfigs.retrieval_model ?? RETRIEVE_TYPE.multiWay

  return nextDatasetConfigs
}

type DatasetSelectHandlerOptions = {
  currentRerankModel?: string
  currentRerankProvider?: string
  dataSets: DataSet[]
  datasetConfigs: DatasetConfigs
  datasetConfigsRef: { current: DatasetConfigs }
  formattingChangedDispatcher: () => void
  hideSelectDataSet: () => void
  setDataSets: (data: DataSet[]) => void
  setDatasetConfigs: (configs: DatasetConfigs) => void
  setRerankSettingModalOpen: (visible: boolean) => void
}

export const createDatasetSelectHandler =
  ({
    currentRerankModel,
    currentRerankProvider,
    dataSets,
    datasetConfigs,
    datasetConfigsRef,
    formattingChangedDispatcher,
    hideSelectDataSet,
    setDataSets,
    setDatasetConfigs,
    setRerankSettingModalOpen,
  }: DatasetSelectHandlerOptions) =>
  (nextDataSets: DataSet[]) => {
    if (
      nextDataSets.map((item) => item.id).join(',') === dataSets.map((item) => item.id).join(',')
    ) {
      hideSelectDataSet()
      return
    }

    formattingChangedDispatcher()
    let mergedDataSets = nextDataSets

    if (nextDataSets.find((item) => !item.name)) {
      const hydrated = produce(nextDataSets, (draft) => {
        nextDataSets.forEach((item, index) => {
          if (!item.name) {
            const originalItem = dataSets.find((existing) => existing.id === item.id)
            if (originalItem) draft[index] = originalItem
          }
        })
      })
      setDataSets(hydrated)
      mergedDataSets = hydrated
    } else {
      setDataSets(nextDataSets)
    }

    hideSelectDataSet()
    const {
      allExternal,
      allInternal,
      mixtureInternalAndExternal,
      mixtureHighQualityAndEconomic,
      inconsistentEmbeddingModel,
    } = getSelectedDatasetsMode(mergedDataSets)

    if (
      (allInternal && (mixtureHighQualityAndEconomic || inconsistentEmbeddingModel)) ||
      mixtureInternalAndExternal ||
      allExternal
    ) {
      setRerankSettingModalOpen(true)
    }

    const { datasets, retrieval_model, score_threshold_enabled, ...restConfigs } = datasetConfigs
    const { top_k, score_threshold, reranking_model, reranking_mode, weights, reranking_enable } =
      restConfigs
    const oldRetrievalConfig = {
      top_k,
      score_threshold,
      reranking_model:
        reranking_model?.reranking_provider_name && reranking_model?.reranking_model_name
          ? {
              provider: reranking_model.reranking_provider_name,
              model: reranking_model.reranking_model_name,
            }
          : undefined,
      reranking_mode,
      weights,
      reranking_enable,
    }
    const retrievalConfig = getMultipleRetrievalConfig(
      oldRetrievalConfig,
      mergedDataSets,
      dataSets,
      {
        provider: currentRerankProvider,
        model: currentRerankModel,
      },
    )

    setDatasetConfigs({
      ...datasetConfigsRef.current,
      ...retrievalConfig,
      reranking_model: {
        reranking_provider_name: retrievalConfig?.reranking_model?.provider || '',
        reranking_model_name: retrievalConfig?.reranking_model?.model || '',
      },
      retrieval_model,
      score_threshold_enabled,
      datasets,
    })
  }

export function useDatasetSelectHandler({
  currentRerankModel,
  currentRerankProvider,
  dataSets,
  datasetConfigs,
  datasetConfigsRef,
  formattingChangedDispatcher,
  hideSelectDataSet,
  setDataSets,
  setDatasetConfigs,
  setRerankSettingModalOpen,
}: DatasetSelectHandlerOptions) {
  return useMemo(
    () =>
      createDatasetSelectHandler({
        currentRerankModel,
        currentRerankProvider,
        dataSets,
        datasetConfigs,
        datasetConfigsRef,
        formattingChangedDispatcher,
        hideSelectDataSet,
        setDataSets,
        setDatasetConfigs,
        setRerankSettingModalOpen,
      }),
    [
      currentRerankModel,
      currentRerankProvider,
      dataSets,
      datasetConfigs,
      datasetConfigsRef,
      formattingChangedDispatcher,
      hideSelectDataSet,
      setDataSets,
      setDatasetConfigs,
      setRerankSettingModalOpen,
    ],
  )
}
