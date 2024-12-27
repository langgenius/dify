'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import Image from 'next/image'
import ProgressIndicator from '../../create/assets/progress-indicator.svg'
import Reranking from '../../create/assets/rerank.svg'
import cn from '@/utils/classnames'
import TopKItem from '@/app/components/base/param-item/top-k-item'
import ScoreThresholdItem from '@/app/components/base/param-item/score-threshold-item'
import { RETRIEVE_METHOD } from '@/types/app'
import Switch from '@/app/components/base/switch'
import Tooltip from '@/app/components/base/tooltip'
import type { RetrievalConfig } from '@/types/app'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { useCurrentProviderAndModel, useModelListAndDefaultModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  DEFAULT_WEIGHTED_SCORE,
  RerankingModeEnum,
  WeightedScoreEnum,
} from '@/models/datasets'
import WeightedScore from '@/app/components/app/configuration/dataset-config/params-config/weighted-score'
import Toast from '@/app/components/base/toast'
import RadioCard from '@/app/components/base/radio-card'

type Props = {
  type: RETRIEVE_METHOD
  value: RetrievalConfig
  onChange: (value: RetrievalConfig) => void
}

const RetrievalParamConfig: FC<Props> = ({
  type,
  value,
  onChange,
}) => {
  const { t } = useTranslation()
  const canToggleRerankModalEnable = type !== RETRIEVE_METHOD.hybrid
  const isEconomical = type === RETRIEVE_METHOD.invertedIndex
  const {
    defaultModel: rerankDefaultModel,
    modelList: rerankModelList,
  } = useModelListAndDefaultModel(ModelTypeEnum.rerank)

  const {
    currentModel,
  } = useCurrentProviderAndModel(
    rerankModelList,
    rerankDefaultModel
      ? {
        ...rerankDefaultModel,
        provider: rerankDefaultModel.provider.provider,
      }
      : undefined,
  )

  const handleDisabledSwitchClick = useCallback(() => {
    if (!currentModel)
      Toast.notify({ type: 'error', message: t('workflow.errorMsg.rerankModelRequired') })
  }, [currentModel, rerankDefaultModel, t])

  const isHybridSearch = type === RETRIEVE_METHOD.hybrid

  const rerankModel = (() => {
    if (value.reranking_model) {
      return {
        provider_name: value.reranking_model.reranking_provider_name,
        model_name: value.reranking_model.reranking_model_name,
      }
    }
    else if (rerankDefaultModel) {
      return {
        provider_name: rerankDefaultModel.provider.provider,
        model_name: rerankDefaultModel.model,
      }
    }
  })()

  const handleChangeRerankMode = (v: RerankingModeEnum) => {
    if (v === value.reranking_mode)
      return

    const result = {
      ...value,
      reranking_mode: v,
    }

    if (!result.weights && v === RerankingModeEnum.WeightedScore) {
      result.weights = {
        weight_type: WeightedScoreEnum.Customized,
        vector_setting: {
          vector_weight: DEFAULT_WEIGHTED_SCORE.other.semantic,
          embedding_provider_name: '',
          embedding_model_name: '',
        },
        keyword_setting: {
          keyword_weight: DEFAULT_WEIGHTED_SCORE.other.keyword,
        },
      }
    }
    onChange(result)
  }

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

  return (
    <div>
      {!isEconomical && !isHybridSearch && (
        <div>
          <div className='flex items-center space-x-2 mb-2'>
            {canToggleRerankModalEnable && (
              <div
                className='flex items-center'
                onClick={handleDisabledSwitchClick}
              >
                <Switch
                  size='md'
                  defaultValue={currentModel ? value.reranking_enable : false}
                  onChange={(v) => {
                    onChange({
                      ...value,
                      reranking_enable: v,
                    })
                  }}
                  disabled={!currentModel}
                />
              </div>
            )}
            <div className='flex items-center'>
              <span className='mr-0.5 system-sm-semibold text-text-secondary'>{t('common.modelProvider.rerankModel.key')}</span>
              <Tooltip
                popupContent={
                  <div className="w-[200px]">{t('common.modelProvider.rerankModel.tip')}</div>
                }
              />
            </div>
          </div>
          <ModelSelector
            triggerClassName={`${!value.reranking_enable && '!opacity-60 !cursor-not-allowed'}`}
            defaultModel={rerankModel && { provider: rerankModel.provider_name, model: rerankModel.model_name }}
            modelList={rerankModelList}
            readonly={!value.reranking_enable}
            onSelect={(v) => {
              onChange({
                ...value,
                reranking_model: {
                  reranking_provider_name: v.provider,
                  reranking_model_name: v.model,
                },
              })
            }}
          />
        </div>
      )}
      {
        !isHybridSearch && (
          <div className={cn(!isEconomical && 'mt-4', 'flex space-between space-x-4')}>
            <TopKItem
              className='grow'
              value={value.top_k}
              onChange={(_key, v) => {
                onChange({
                  ...value,
                  top_k: v,
                })
              }}
              enable={true}
            />
            {(!isEconomical && !(value.search_method === RETRIEVE_METHOD.fullText && !value.reranking_enable)) && (
              <ScoreThresholdItem
                className='grow'
                value={value.score_threshold}
                onChange={(_key, v) => {
                  onChange({
                    ...value,
                    score_threshold: v,
                  })
                }}
                enable={value.score_threshold_enabled}
                hasSwitch={true}
                onSwitchChange={(_key, v) => {
                  onChange({
                    ...value,
                    score_threshold_enabled: v,
                  })
                }}
              />
            )}
          </div>
        )
      }
      {
        isHybridSearch && (
          <>
            <div className='flex gap-2 mb-4'>
              {
                rerankingModeOptions.map(option => (
                  <RadioCard
                    key={option.value}
                    isChosen={value.reranking_mode === option.value}
                    onChosen={() => handleChangeRerankMode(option.value)}
                    icon={<Image src={
                      option.value === RerankingModeEnum.WeightedScore
                        ? ProgressIndicator
                        : Reranking
                    } alt=''/>}
                    title={option.label}
                    description={option.tips}
                    className='flex-1'
                  />
                ))
              }
            </div>
            {
              value.reranking_mode === RerankingModeEnum.WeightedScore && (
                <WeightedScore
                  value={{
                    value: [
                      value.weights!.vector_setting.vector_weight,
                      value.weights!.keyword_setting.keyword_weight,
                    ],
                  }}
                  onChange={(v) => {
                    onChange({
                      ...value,
                      weights: {
                        ...value.weights!,
                        vector_setting: {
                          ...value.weights!.vector_setting,
                          vector_weight: v.value[0],
                        },
                        keyword_setting: {
                          ...value.weights!.keyword_setting,
                          keyword_weight: v.value[1],
                        },
                      },
                    })
                  }}
                />
              )
            }
            {
              value.reranking_mode !== RerankingModeEnum.WeightedScore && (
                <ModelSelector
                  triggerClassName={`${!value.reranking_enable && '!opacity-60 !cursor-not-allowed'}`}
                  defaultModel={rerankModel && { provider: rerankModel.provider_name, model: rerankModel.model_name }}
                  modelList={rerankModelList}
                  readonly={!value.reranking_enable}
                  onSelect={(v) => {
                    onChange({
                      ...value,
                      reranking_model: {
                        reranking_provider_name: v.provider,
                        reranking_model_name: v.model,
                      },
                    })
                  }}
                />
              )
            }
            <div className={cn(!isEconomical && 'mt-4', 'flex space-between space-x-6')}>
              <TopKItem
                className='grow'
                value={value.top_k}
                onChange={(_key, v) => {
                  onChange({
                    ...value,
                    top_k: v,
                  })
                }}
                enable={true}
              />
              <ScoreThresholdItem
                className='grow'
                value={value.score_threshold}
                onChange={(_key, v) => {
                  onChange({
                    ...value,
                    score_threshold: v,
                  })
                }}
                enable={value.score_threshold_enabled}
                hasSwitch={true}
                onSwitchChange={(_key, v) => {
                  onChange({
                    ...value,
                    score_threshold_enabled: v,
                  })
                }}
              />
            </div>
          </>
        )
      }
    </div>
  )
}
export default React.memo(RetrievalParamConfig)
