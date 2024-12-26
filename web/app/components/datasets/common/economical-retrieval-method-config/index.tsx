'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Image from 'next/image'
import RetrievalParamConfig from '../retrieval-param-config'
import { OptionCard } from '../../create/step-two/option-card'
import { retrievalIcon } from '../../create/icons'
import { RETRIEVE_METHOD } from '@/types/app'
import type { RetrievalConfig } from '@/types/app'

type Props = {
  value: RetrievalConfig
  onChange: (value: RetrievalConfig) => void
}

const EconomicalRetrievalMethodConfig: FC<Props> = ({
  value,
  onChange,
}) => {
  const { t } = useTranslation()

  return (
    <div className='space-y-2'>
      <OptionCard icon={<Image className='w-4 h-4' src={retrievalIcon.vector} alt='' />}
        title={t('dataset.retrieval.invertedIndex.title')}
        description={t('dataset.retrieval.invertedIndex.description')} isActive
        activeHeaderClassName='bg-dataset-option-card-purple-gradient'
      >
        <RetrievalParamConfig
          type={RETRIEVE_METHOD.invertedIndex}
          value={value}
          onChange={onChange}
        />
      </OptionCard>
    </div>
  )
}
export default React.memo(EconomicalRetrievalMethodConfig)
