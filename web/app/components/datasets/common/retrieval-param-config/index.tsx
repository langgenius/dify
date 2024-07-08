'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import {
  RiQuestionLine,
} from '@remixicon/react'
import TopKItem from '@/app/components/base/param-item/top-k-item'
import ScoreThresholdItem from '@/app/components/base/param-item/score-threshold-item'
import { RETRIEVE_METHOD } from '@/types/app'
import Switch from '@/app/components/base/switch'
import Tooltip from '@/app/components/base/tooltip-plus'
import type { RetrievalConfig } from '@/types/app'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { useModelListAndDefaultModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'

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

  return (
    <div>
      {!isEconomical && (
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
            triggerClassName={`${!value.reranking_enable && type !== RETRIEVE_METHOD.hybrid && '!opacity-60 !cursor-not-allowed'}`}
            defaultModel={rerankModel && { provider: rerankModel.provider_name, model: rerankModel.model_name }}
            modelList={rerankModelList}
            readonly={!value.reranking_enable && type !== RETRIEVE_METHOD.hybrid}
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
    </div>
  )
}
export default React.memo(RetrievalParamConfig)
