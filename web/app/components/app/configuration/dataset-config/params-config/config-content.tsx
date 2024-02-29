'use client'
import React from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
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

type Props = {
  datasetConfigs: DatasetConfigs
  onChange: (configs: DatasetConfigs, isRetrievalModeChange?: boolean) => void
}

const ConfigContent: FC<Props> = ({
  datasetConfigs,
  onChange,
}) => {
  const { t } = useTranslation()
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
    currentModel: isRerankDefaultModelVaild,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(3)

  const rerankModel = (() => {
    if (datasetConfigs.reranking_model) {
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
  return (
    <div>
      <div className='mt-2 space-y-3'>
        <RadioCard
          icon={<NTo1Retrieval className='shrink-0 mr-3 w-9 h-9 rounded-lg' />}
          title={t('appDebug.datasetConfig.retrieveOneWay.title')}
          description={t('appDebug.datasetConfig.retrieveOneWay.description')}
          isChosen={type === RETRIEVE_TYPE.oneWay}
          onChosen={() => { setType(RETRIEVE_TYPE.oneWay) }}
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
          <div className='mt-6'>
            <div className='leading-[32px] text-[13px] font-medium text-gray-900'>{t('common.modelProvider.rerankModel.key')}</div>
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
          <div className='mt-4 space-y-4'>
            <TopKItem
              value={datasetConfigs.top_k}
              onChange={handleParamChange}
              enable={true}
            />
            <ScoreThresholdItem
              value={datasetConfigs.score_threshold}
              onChange={handleParamChange}
              enable={datasetConfigs.score_threshold_enabled}
              hasSwitch={true}
              onSwitchChange={handleSwitch}
            />
          </div>
        </>
      )}
    </div>
  )
}
export default React.memo(ConfigContent)
