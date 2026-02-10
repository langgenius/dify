'use client'
import type { FC } from 'react'
import type { RetrievalConfig } from '@/types/app'
import Image from 'next/image'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import RadioCard from '@/app/components/base/radio-card'
import { RETRIEVE_METHOD } from '@/types/app'
import { retrievalIcon } from '../../create/icons'

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
  const icon = <Image className="size-3.5 text-util-colors-purple-purple-600" src={getIcon(type)} alt="" />
  return (
    <div className="space-y-2">
      <RadioCard
        icon={icon}
        title={t(`retrieval.${type}.title`, { ns: 'dataset' })}
        description={t(`retrieval.${type}.description`, { ns: 'dataset' })}
        noRadio
        chosenConfigWrapClassName="!pb-3"
        chosenConfig={(
          <div className="flex flex-wrap text-xs font-normal leading-[18px]">
            {value.reranking_model.reranking_model_name && (
              <div className="mr-8 flex space-x-1">
                <div className="text-gray-500">{t('modelProvider.rerankModel.key', { ns: 'common' })}</div>
                <div className="font-medium text-gray-800">{value.reranking_model.reranking_model_name}</div>
              </div>
            )}

            <div className="mr-8 flex space-x-1">
              <div className="text-gray-500">{t('datasetConfig.top_k', { ns: 'appDebug' })}</div>
              <div className="font-medium text-gray-800">{value.top_k}</div>
            </div>

            <div className="mr-8 flex space-x-1">
              <div className="text-gray-500">{t('datasetConfig.score_threshold', { ns: 'appDebug' })}</div>
              <div className="font-medium text-gray-800">{value.score_threshold}</div>
            </div>
          </div>
        )}
      />
    </div>
  )
}
export default React.memo(EconomicalRetrievalMethodConfig)
