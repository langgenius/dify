'use client'

import { memo, useMemo } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiAlertFill,
} from '@remixicon/react'
import WeightedScore from './weighted-score'
import TopKItem from '@/app/components/base/param-item/top-k-item'
import ScoreThresholdItem from '@/app/components/base/param-item/score-threshold-item'
import RadioCard from '@/app/components/base/radio-card/simple'
import { RETRIEVE_TYPE } from '@/types/app'
import {
  MultiPathRetrieval,
  NTo1Retrieval,
} from '@/app/components/base/icons/src/public/common'
import type {
  DatasetConfigs,
} from '@/models/debug'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
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
import { useGetLanguage } from '@/context/i18n'

type Props = {
  datasetConfigs: DatasetConfigs
  onChange: (configs: DatasetConfigs, isRetrievalModeChange?: boolean) => void
  isInWorkflow?: boolean
  singleRetrievalModelConfig?: ModelConfig
  onSingleRetrievalModelChange?: (config: ModelConfig) => void
  onSingleRetrievalModelParamsChange?: (config: ModelConfig) => void
  selectedDatasets?: DataSet[]
}

const LEGACY_LINK_MAP = {
  en_US: 'https://docs.dify.ai/guides/knowledge-base/integrate-knowledge-within-application',
  zh_Hans: 'https://docs.dify.ai/v/zh-hans/guides/knowledge-base/integrate_knowledge_within_application',
} as Record<string, string>

const ConfigContent: FC<Props> = ({
  datasetConfigs,
  onChange,
  isInWorkflow,
  singleRetrievalModelConfig: singleRetrievalConfig = {} as ModelConfig,
  onSingleRetrievalModelChange = () => { },
  onSingleRetrievalModelParamsChange = () => { },
  selectedDatasets = [],
}) => {
  const { t } = useTranslation()
  const language = useGetLanguage()
  const selectedDatasetsMode = useSelectedDatasetsMode(selectedDatasets)
  const type = datasetConfigs.retrieval_model
  const setType = (value: RETRIEVE_TYPE) => {
    onChange({
      ...datasetConfigs,
      retrieval_model: value,
    }, true)
  }
  const {
    modelList: rerankModelList,
    defaultModel: rerankDefaultModel,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.rerank)
  const rerankModel = (() => {
    if (datasetConfigs.reranking_model?.reranking_provider_name) {
      return {
        provider_name: datasetConfigs.reranking_model.reranking_provider_name,
        model_name: datasetConfigs.reranking_model.reranking_model_name,
      }
    }
    else if (rerankDefaultModel) {
      return {
        provider_name: rerankDefaultModel.provider.provider,
        model_name: rerankDefaultModel.model,
      }
    }
  })()

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
    onChange({
      ...datasetConfigs,
      reranking_mode: mode,
    })
  }

  const model = singleRetrievalConfig

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

  const showRerankModel = useMemo(() => {
    if (datasetConfigs.reranking_enable === false && selectedDatasetsMode.allEconomic)
      return false

    return true
  }, [datasetConfigs.reranking_enable, selectedDatasetsMode.allEconomic])

  return (
    <div>
      <div className='system-xl-semibold text-text-primary'>{t('dataset.retrievalSettings')}</div>
      <div className='mt-2 space-y-3'>
        <RadioCard
          icon={<NTo1Retrieval className='shrink-0 mr-3 w-9 h-9 rounded-lg' />}
          title={(
            <div className='flex items-center'>
              {t('appDebug.datasetConfig.retrieveOneWay.title')}
              <Tooltip
                popupContent={(
                  <div className='w-[320px]'>
                    {t('dataset.nTo1RetrievalLegacy')}
                  </div>
                )}
              >
                <div className='ml-1 flex items-center px-[5px] h-[18px] rounded-[5px] border border-text-accent-secondary system-2xs-medium-uppercase text-text-accent-secondary'>legacy</div>
              </Tooltip>
            </div>
          )}
          description={t('appDebug.datasetConfig.retrieveOneWay.description')}
          isChosen={type === RETRIEVE_TYPE.oneWay}
          onChosen={() => { setType(RETRIEVE_TYPE.oneWay) }}
          extra={(
            <div className='flex pl-3 pr-1 py-3 border-t border-divider-subtle bg-state-warning-hover rounded-b-xl'>
              <RiAlertFill className='shrink-0 mr-1.5 w-4 h-4 text-text-warning-secondary' />
              <div className='system-xs-medium text-text-primary'>
                {t('dataset.nTo1RetrievalLegacyLinkText')}
                <a
                  className='text-text-accent'
                  href={LEGACY_LINK_MAP[language]}
                  target='_blank'
                  rel='noopener noreferrer'
                >
                  {t('dataset.nTo1RetrievalLegacyLink')}
                </a>
              </div>
            </div>
          )}
        />
        <RadioCard
          icon={<MultiPathRetrieval className='shrink-0 mr-3 w-9 h-9 rounded-lg' />}
          title={t('appDebug.datasetConfig.retrieveMultiWay.title')}
          description={t('appDebug.datasetConfig.retrieveMultiWay.description')}
          isChosen={type === RETRIEVE_TYPE.multiWay}
          onChosen={() => { setType(RETRIEVE_TYPE.multiWay) }}
        />
      </div>
      {type === RETRIEVE_TYPE.multiWay && (
        <>
          <div className='mb-2 mt-4 h-[1px] bg-divider-subtle'></div>
          <div
            className='flex items-center mb-2 h-6 system-md-semibold text-text-secondary'
          >
            {t('dataset.rerankSettings')}
          </div>
          {
            selectedDatasetsMode.inconsistentEmbeddingModel
            && (
              <div className='mt-4 system-xs-regular text-text-warning'>
                {t('dataset.inconsistentEmbeddingModelTip')}
              </div>
            )
          }
          {
            selectedDatasetsMode.mixtureHighQualityAndEconomic
            && (
              <div className='mt-4 system-xs-regular text-text-warning'>
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
                        'flex items-center justify-center w-[calc((100%-8px)/2)] h-8 rounded-lg border border-components-option-card-option-border bg-components-option-card-option-bg cursor-pointer system-sm-medium text-text-secondary',
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
                    selectedDatasetsMode.allEconomic && (
                      <Switch
                        size='md'
                        defaultValue={showRerankModel}
                        onChange={(v) => {
                          onChange({
                            ...datasetConfigs,
                            reranking_enable: v,
                          })
                        }}
                      />
                    )
                  }
                  <div className='ml-2 leading-[32px] text-[13px] font-medium text-gray-900'>{t('common.modelProvider.rerankModel.key')}</div>
                  <Tooltip
                    popupContent={
                      <div className="w-[200px]">
                        {t('common.modelProvider.rerankModel.tip')}
                      </div>
                    }
                    popupClassName='ml-0.5'
                    triggerClassName='ml-0.5 w-3.5 h-3.5'
                  />
                </div>
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
            <div className='leading-[32px] text-[13px] font-medium text-gray-900'>{t('common.modelProvider.systemReasoningModel.key')}</div>
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
            setModel={onSingleRetrievalModelChange as any}
            onCompletionParamsChange={onSingleRetrievalModelParamsChange as any}
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
