'use client'

import { memo, useCallback, useEffect, useMemo } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import WeightedScore from './weighted-score'
import TopKItem from '@/app/components/base/param-item/top-k-item'
import ScoreThresholdItem from '@/app/components/base/param-item/score-threshold-item'
import { RETRIEVE_TYPE } from '@/types/app'
import type {
  DatasetConfigs,
} from '@/models/debug'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { useCurrentProviderAndModel, useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import type { ModelConfig } from '@/app/components/workflow/types'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import Tooltip from '@/app/components/base/tooltip'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type {
  DataSet,
} from '@/models/datasets'
import { RerankingModeEnum } from '@/models/datasets'
import cn from '@/utils/classnames'
import { useSelectedDatasetsMode } from '@/app/components/workflow/nodes/knowledge-retrieval/hooks'
import Switch from '@/app/components/base/switch'
import Toast from '@/app/components/base/toast'
import Divider from '@/app/components/base/divider'
import { noop } from 'lodash-es'

type Props = {
  datasetConfigs: DatasetConfigs
  onChange: (configs: DatasetConfigs, isRetrievalModeChange?: boolean) => void
  selectedDatasets?: DataSet[]
  isInWorkflow?: boolean
  singleRetrievalModelConfig?: ModelConfig
  onSingleRetrievalModelChange?: (config: ModelConfig) => void
  onSingleRetrievalModelParamsChange?: (config: ModelConfig) => void
}

const ConfigContent: FC<Props> = ({
  datasetConfigs,
  onChange,
  isInWorkflow,
  singleRetrievalModelConfig: singleRetrievalConfig = {} as ModelConfig,
  onSingleRetrievalModelChange = noop,
  onSingleRetrievalModelParamsChange = noop,
  selectedDatasets = [],
}) => {
  const { t } = useTranslation()
  const selectedDatasetsMode = useSelectedDatasetsMode(selectedDatasets)
  const type = datasetConfigs.retrieval_model

  useEffect(() => {
    if (type === RETRIEVE_TYPE.oneWay) {
      onChange({
        ...datasetConfigs,
        retrieval_model: RETRIEVE_TYPE.multiWay,
      }, isInWorkflow)
    }
  }, [type, datasetConfigs, isInWorkflow, onChange])

  const {
    modelList: rerankModelList,
    currentModel: validDefaultRerankModel,
    currentProvider: validDefaultRerankProvider,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.rerank)

  /**
   * If reranking model is set and is valid, use the reranking model
   * Otherwise, check if the default reranking model is valid
   */
  const {
    currentModel: currentRerankModel,
  } = useCurrentProviderAndModel(
    rerankModelList,
    {
      provider: datasetConfigs.reranking_model?.reranking_provider_name || validDefaultRerankProvider?.provider || '',
      model: datasetConfigs.reranking_model?.reranking_model_name || validDefaultRerankModel?.model || '',
    },
  )

  const rerankModel = useMemo(() => {
    return {
      provider_name: datasetConfigs.reranking_model?.reranking_provider_name ?? '',
      model_name: datasetConfigs.reranking_model?.reranking_model_name ?? '',
    }
  }, [datasetConfigs.reranking_model])

  const handleParamChange = (key: string, value: number) => {
    if (key === 'top_k') {
      onChange({
        ...datasetConfigs,
        top_k: value,
      })
    }
    else if (key === 'score_threshold') {
      onChange({
        ...datasetConfigs,
        score_threshold: value,
      })
    }
  }

  const handleSwitch = (key: string, enable: boolean) => {
    if (key === 'top_k')
      return

    onChange({
      ...datasetConfigs,
      score_threshold_enabled: enable,
    })
  }

  const handleWeightedScoreChange = (value: { value: number[] }) => {
    const configs = {
      ...datasetConfigs,
      weights: {
        ...datasetConfigs.weights!,
        vector_setting: {
          ...datasetConfigs.weights!.vector_setting!,
          vector_weight: value.value[0],
        },
        keyword_setting: {
          keyword_weight: value.value[1],
        },
      },
    }
    onChange(configs)
  }

  const handleRerankModeChange = (mode: RerankingModeEnum) => {
    if (mode === datasetConfigs.reranking_mode)
      return

    if (mode === RerankingModeEnum.RerankingModel && !currentRerankModel)
      Toast.notify({ type: 'error', message: t('workflow.errorMsg.rerankModelRequired') })

    onChange({
      ...datasetConfigs,
      reranking_mode: mode,
    })
  }

  const model = singleRetrievalConfig // Legacy code, for compatibility, have to keep it

  const rerankingModeOptions = [
    {
      value: RerankingModeEnum.WeightedScore,
      label: t('dataset.weightedScore.title'),
      tips: t('dataset.weightedScore.description'),
    },
    {
      value: RerankingModeEnum.RerankingModel,
      label: t('common.modelProvider.rerankModel.key'),
      tips: t('common.modelProvider.rerankModel.tip'),
    },
  ]

  const showWeightedScore = selectedDatasetsMode.allHighQuality
    && !selectedDatasetsMode.inconsistentEmbeddingModel

  const showWeightedScorePanel = showWeightedScore && datasetConfigs.reranking_mode === RerankingModeEnum.WeightedScore && datasetConfigs.weights
  const selectedRerankMode = datasetConfigs.reranking_mode || RerankingModeEnum.RerankingModel

  const canManuallyToggleRerank = useMemo(() => {
    return (selectedDatasetsMode.allInternal && selectedDatasetsMode.allEconomic)
      || selectedDatasetsMode.allExternal
  }, [selectedDatasetsMode.allEconomic, selectedDatasetsMode.allExternal, selectedDatasetsMode.allInternal])

  const showRerankModel = useMemo(() => {
    if (!canManuallyToggleRerank)
      return true

    return datasetConfigs.reranking_enable
  }, [datasetConfigs.reranking_enable, canManuallyToggleRerank])

  const handleManuallyToggleRerank = useCallback((enable: boolean) => {
    if (!currentRerankModel && enable)
      Toast.notify({ type: 'error', message: t('workflow.errorMsg.rerankModelRequired') })
    onChange({
      ...datasetConfigs,
      reranking_enable: enable,
    })
  }, [currentRerankModel, datasetConfigs, onChange])

  return (
    <div>
      <div className='system-xl-semibold text-text-primary'>{t('dataset.retrievalSettings')}</div>
      <div className='system-xs-regular text-text-tertiary'>
        {t('dataset.defaultRetrievalTip')}
      </div>
      {type === RETRIEVE_TYPE.multiWay && (
        <>
          <div className='my-2 flex h-6 items-center py-1'>
            <div className='system-xs-semibold-uppercase mr-2 shrink-0 text-text-secondary'>
              {t('dataset.rerankSettings')}
            </div>
            <Divider bgStyle='gradient' className='mx-0 !h-px' />
          </div>
          {
            selectedDatasetsMode.inconsistentEmbeddingModel
            && (
              <div className='system-xs-medium mt-4 text-text-warning'>
                {t('dataset.inconsistentEmbeddingModelTip')}
              </div>
            )
          }
          {
            selectedDatasetsMode.mixtureInternalAndExternal && (
              <div className='system-xs-medium mt-4 text-text-warning'>
                {t('dataset.mixtureInternalAndExternalTip')}
              </div>
            )
          }
          {
            selectedDatasetsMode.allExternal && (
              <div className='system-xs-medium mt-4 text-text-warning'>
                {t('dataset.allExternalTip')}
              </div>
            )
          }
          {
            selectedDatasetsMode.mixtureHighQualityAndEconomic
            && (
              <div className='system-xs-medium mt-4 text-text-warning'>
                {t('dataset.mixtureHighQualityAndEconomicTip')}
              </div>
            )
          }
          {
            showWeightedScore && (
              <div className='flex items-center justify-between'>
                {
                  rerankingModeOptions.map(option => (
                    <div
                      key={option.value}
                      className={cn(
                        'system-sm-medium flex h-8 w-[calc((100%-8px)/2)] cursor-pointer items-center justify-center rounded-lg border border-components-option-card-option-border bg-components-option-card-option-bg text-text-secondary',
                        selectedRerankMode === option.value && 'border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg text-text-primary',
                      )}
                      onClick={() => handleRerankModeChange(option.value)}
                    >
                      <div className='truncate'>{option.label}</div>
                      <Tooltip
                        popupContent={
                          <div className='w-[200px]'>
                            {option.tips}
                          </div>
                        }
                        popupClassName='ml-0.5'
                        triggerClassName='ml-0.5 w-3.5 h-3.5'
                      />
                    </div>
                  ))
                }
              </div>
            )
          }
          {
            !showWeightedScorePanel && (
              <div className='mt-2'>
                <div className='flex items-center'>
                  {
                    canManuallyToggleRerank && (
                      <Switch
                        size='md'
                        defaultValue={showRerankModel}
                        onChange={handleManuallyToggleRerank}
                      />
                    )
                  }
                  <div className='system-sm-semibold ml-1 leading-[32px] text-text-secondary'>{t('common.modelProvider.rerankModel.key')}</div>
                  <Tooltip
                    popupContent={
                      <div className="w-[200px]">
                        {t('common.modelProvider.rerankModel.tip')}
                      </div>
                    }
                    popupClassName='ml-1'
                    triggerClassName='ml-1 w-4 h-4'
                  />
                </div>
                {
                  showRerankModel && (
                    <div>
                      <ModelSelector
                        defaultModel={rerankModel && { provider: rerankModel?.provider_name, model: rerankModel?.model_name }}
                        onSelect={(v) => {
                          onChange({
                            ...datasetConfigs,
                            reranking_model: {
                              reranking_provider_name: v.provider,
                              reranking_model_name: v.model,
                            },
                          })
                        }}
                        modelList={rerankModelList}
                      />
                    </div>
                  )}
              </div>
            )
          }
          {
            showWeightedScorePanel
            && (
              <div className='mt-2 space-y-4'>
                <WeightedScore
                  value={{
                    value: [
                      datasetConfigs.weights!.vector_setting.vector_weight,
                      datasetConfigs.weights!.keyword_setting.keyword_weight,
                    ],
                  }}
                  onChange={handleWeightedScoreChange}
                />
                <TopKItem
                  value={datasetConfigs.top_k}
                  onChange={handleParamChange}
                  enable={true}
                />
                <ScoreThresholdItem
                  value={datasetConfigs.score_threshold as number}
                  onChange={handleParamChange}
                  enable={datasetConfigs.score_threshold_enabled}
                  hasSwitch={true}
                  onSwitchChange={handleSwitch}
                />
              </div>
            )
          }
          {
            !showWeightedScorePanel
            && (
              <div className='mt-4 space-y-4'>
                <TopKItem
                  value={datasetConfigs.top_k}
                  onChange={handleParamChange}
                  enable={true}
                />
                {
                  showRerankModel && (
                    <ScoreThresholdItem
                      value={datasetConfigs.score_threshold as number}
                      onChange={handleParamChange}
                      enable={datasetConfigs.score_threshold_enabled}
                      hasSwitch={true}
                      onSwitchChange={handleSwitch}
                    />
                  )
                }
              </div>
            )
          }
        </>
      )}

      {isInWorkflow && type === RETRIEVE_TYPE.oneWay && (
        <div className='mt-4'>
          <div className='flex items-center space-x-0.5'>
            <div className='text-[13px] font-medium leading-[32px] text-text-primary'>{t('common.modelProvider.systemReasoningModel.key')}</div>
            <Tooltip
              popupContent={t('common.modelProvider.systemReasoningModel.tip')}
            />
          </div>
          <ModelParameterModal
            isInWorkflow={isInWorkflow}
            popupClassName='!w-[387px]'
            portalToFollowElemContentClassName='!z-[1002]'
            isAdvancedMode={true}
            mode={model?.mode}
            provider={model?.provider}
            completionParams={model?.completion_params}
            modelId={model?.name}
            setModel={onSingleRetrievalModelChange}
            onCompletionParamsChange={onSingleRetrievalModelParamsChange}
            hideDebugWithMultipleModel
            debugWithMultipleModel={false}
          />
        </div>
      )
      }
    </div >
  )
}
export default memo(ConfigContent)
