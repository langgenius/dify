'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiQuestionLine,
} from '@remixicon/react'
import cn from '@/utils/classnames'
import TopKItem from '@/app/components/base/param-item/top-k-item'
import ScoreThresholdItem from '@/app/components/base/param-item/score-threshold-item'
import { RETRIEVE_METHOD } from '@/types/app'
import Switch from '@/app/components/base/switch'
import Tooltip from '@/app/components/base/tooltip-plus'
import type { RetrievalConfig } from '@/types/app'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { useModelListAndDefaultModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  RerankingModeEnum,
  WeightedScoreEnum,
} from '@/models/datasets'
import WeightedScore from '@/app/components/app/configuration/dataset-config/params-config/weighted-score'

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
          vector_weight: 0.5,
          embedding_provider_name: '',
          embedding_model_name: '',
        },
        keyword_setting: {
          keyword_weight: 0.5,
        },
      }
    }
    onChange(result)
  }

  return (
    <div>
      {!isEconomical && !isHybridSearch && (
        <div>
          <div className='flex h-8 items-center text-[13px] font-medium text-gray-900 space-x-2'>
            {canToggleRerankModalEnable && (
              <Switch
                size='md'
                defaultValue={value.reranking_enable}
                onChange={(v) => {
                  onChange({
                    ...value,
                    reranking_enable: v,
                  })
                }}
              />
            )}
            <div className='flex items-center'>
              <span className='mr-0.5'>{t('common.modelProvider.rerankModel.key')}</span>
              <Tooltip popupContent={<div className="w-[200px]">{t('common.modelProvider.rerankModel.tip')}</div>}>
                <RiQuestionLine className='w-[14px] h-[14px] text-gray-400' />
              </Tooltip>
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
            <div
              className={cn(
                'mb-2 px-4 py-3 rounded-[10px] border border-components-option-card-option-border bg-components-option-card-option-bg',
                value.reranking_mode === RerankingModeEnum.WeightedScore && 'border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg shadow-xs',
                value.reranking_mode !== RerankingModeEnum.WeightedScore && 'cursor-pointer',
              )}
              onClick={() => handleChangeRerankMode(RerankingModeEnum.WeightedScore)}
            >
              <div className='flex items-center h-6 system-sm-semibold text-text-secondary'>
                <div className='mr-0.5'>{t('dataset.weightedScore.title')}</div>
                <Tooltip popupContent={<div className="w-[200px]">{t('dataset.weightedScore.description')}</div>}>
                  <RiQuestionLine className='w-[14px] h-[14px] text-text-quaternary' />
                </Tooltip>
              </div>
              {
                value.reranking_mode === RerankingModeEnum.WeightedScore && (
                  <>
                    <WeightedScore
                      value={{
                        type: value.weights!.weight_type,
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
                            weight_type: v.type,
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
            <div
              className={cn(
                'px-4 py-3 rounded-[10px] border border-components-option-card-option-border bg-components-option-card-option-bg',
                value.reranking_mode !== RerankingModeEnum.WeightedScore && 'border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg shadow-xs',
                value.reranking_mode === RerankingModeEnum.RerankingModel && 'cursor-pointer',
              )}
              onClick={() => handleChangeRerankMode(RerankingModeEnum.RerankingModel)}
            >
              <div className='flex items-center h-6 system-sm-semibold text-text-secondary'>
                <div className='mr-0.5'>{t('common.modelProvider.rerankModel.key')}</div>
                <Tooltip popupContent={<div className="w-[200px]">{t('common.modelProvider.rerankModel.tip')}</div>}>
                  <RiQuestionLine className='w-[14px] h-[14px] text-text-quaternary' />
                </Tooltip>
              </div>
              {
                value.reranking_mode !== RerankingModeEnum.WeightedScore && (
                  <>
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
          </>
        )
      }
    </div>
  )
}
export default React.memo(RetrievalParamConfig)
