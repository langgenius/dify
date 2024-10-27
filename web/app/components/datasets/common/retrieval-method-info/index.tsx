'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { RetrievalConfig } from '@/types/app'
import { RETRIEVE_METHOD } from '@/types/app'
import RadioCard from '@/app/components/base/radio-card'
import { HighPriority } from '@/app/components/base/icons/src/vender/solid/arrows'
import { PatternRecognition, Semantic } from '@/app/components/base/icons/src/vender/solid/development'
import { FileSearch02 } from '@/app/components/base/icons/src/vender/solid/files'

type Props = {
  value: RetrievalConfig
}

export const getIcon = (type: RETRIEVE_METHOD) => {
  return ({
    [RETRIEVE_METHOD.semantic]: Semantic,
    [RETRIEVE_METHOD.fullText]: FileSearch02,
    [RETRIEVE_METHOD.hybrid]: PatternRecognition,
    [RETRIEVE_METHOD.invertedIndex]: HighPriority,
  })[type] || FileSearch02
}

const EconomicalRetrievalMethodConfig: FC<Props> = ({
  // type,
  value,
}) => {
  const { t } = useTranslation()
  const type = value.search_method
  const Icon = getIcon(type)
  return (
    <div className='space-y-2'>
      <RadioCard
        icon={<Icon className='w-4 h-4 text-[#7839EE]' />}
        title={t(`dataset.retrieval.${type}.title`)}
        description={t(`dataset.retrieval.${type}.description`)}
        noRadio
        chosenConfigWrapClassName='!pb-3'
        chosenConfig={
          <div className='flex flex-wrap leading-[18px] text-xs font-normal'>
            {value.reranking_model.reranking_model_name && (
              <div className='mr-8 flex space-x-1'>
                <div className='text-gray-500'>{t('common.modelProvider.rerankModel.key')}</div>
                <div className='font-medium text-gray-800'>{value.reranking_model.reranking_model_name}</div>
              </div>
            )}

            <div className='mr-8 flex space-x-1'>
              <div className='text-gray-500'>{t('appDebug.datasetConfig.top_k')}</div>
              <div className='font-medium text-gray-800'>{value.top_k}</div>
            </div>

            <div className='mr-8 flex space-x-1'>
              <div className='text-gray-500'>{t('appDebug.datasetConfig.score_threshold')}</div>
              <div className='font-medium text-gray-800'>{value.score_threshold}</div>
            </div>
          </div>
        }
      />
    </div>
  )
}
export default React.memo(EconomicalRetrievalMethodConfig)
