'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Image from 'next/image'
import { retrievalIcon } from '../../create/icons'
import type { RetrievalConfig } from '@/types/app'
import { RETRIEVE_METHOD } from '@/types/app'
import RadioCard from '@/app/components/base/radio-card'

type Props = {
  value: RetrievalConfig
}

export const getIcon = (type: RETRIEVE_METHOD) => {
  return ({
    [RETRIEVE_METHOD.semantic]: retrievalIcon.vector,
    [RETRIEVE_METHOD.fullText]: retrievalIcon.fullText,
    [RETRIEVE_METHOD.hybrid]: retrievalIcon.hybrid,
    [RETRIEVE_METHOD.invertedIndex]: retrievalIcon.vector,
    [RETRIEVE_METHOD.keywordSearch]: retrievalIcon.vector,
  })[type] || retrievalIcon.vector
}

const EconomicalRetrievalMethodConfig: FC<Props> = ({
  // type,
  value,
}) => {
  const { t } = useTranslation()
  const type = value.search_method
  const icon = <Image className='size-3.5 text-util-colors-purple-purple-600' src={getIcon(type)} alt='' />
  return (
    <div className='space-y-2'>
      <RadioCard
        icon={icon}
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
