'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import TopKItem from '@/app/components/base/param-item/top-k-item'
import ScoreThresholdItem from '@/app/components/base/param-item/score-threshold-item'
import { RETRIEVE_METHOD } from '@/types/app'
import Switch from '@/app/components/base/switch'
import Tooltip from '@/app/components/base/tooltip-plus'
import { HelpCircle } from '@/app/components/base/icons/src/vender/line/general'
import ModelSelector from '@/app/components/header/account-setting/model-page/model-selector'
import { ModelType } from '@/app/components/header/account-setting/model-page/declarations'
import type { RetrievalConfig } from '@/types/app'
import { useProviderContext } from '@/context/provider-context'

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
    rerankDefaultModel,
  } = useProviderContext()

  const rerankModel = (() => {
    if (value.reranking_model) {
      return {
        provider_name: value.reranking_model.reranking_provider_name,
        model_name: value.reranking_model.reranking_model_name,
      }
    }
    else if (rerankDefaultModel) {
      return {
        provider_name: rerankDefaultModel.model_provider.provider_name,
        model_name: rerankDefaultModel.model_name,
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
                <HelpCircle className='w-[14px] h-[14px] text-gray-400' />
              </Tooltip>
            </div>
          </div>
          <div>
            <ModelSelector
              whenEmptyGoToSetting
              popClassName='!max-w-[100%] !w-full'
              value={rerankModel && { providerName: rerankModel.provider_name, modelName: rerankModel.model_name } as any}
              modelType={ModelType.reranking}
              readonly={!value.reranking_enable && type !== RETRIEVE_METHOD.hybrid}
              onChange={(v) => {
                onChange({
                  ...value,
                  reranking_model: {
                    reranking_provider_name: v.model_provider.provider_name,
                    reranking_model_name: v.model_name,
                  },
                })
              }}
            />
          </div>
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
            enable={value.score_threshold_enable}
            hasSwitch={true}
            onSwitchChange={(_key, v) => {
              onChange({
                ...value,
                score_threshold_enable: v,
              })
            }}
          />
        )}
      </div>
    </div>
  )
}
export default React.memo(RetrievalParamConfig)
