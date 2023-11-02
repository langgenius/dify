'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import RetrivalParamConfig from '../retrival-param-config'
import { RETRIEVE_METHOD } from '@/types/app'
import RadioCard from '@/app/components/base/radio-card'
import { Semantic } from '@/app/components/base/icons/src/vender/solid/development'

type Props = {
  value: RETRIEVE_METHOD
  onChange: (value: RETRIEVE_METHOD) => void
}

const EconomicalRetrievalMethodConfig: FC<Props> = ({
  value,
  onChange,
}) => {
  const { t } = useTranslation()

  return (
    <div className='space-y-2'>
      <RadioCard
        icon={<Semantic className='w-4 h-4 text-[#7839EE]' />}
        title={t('dataset.retrival.invertedIndex.title')}
        description={t('dataset.retrival.invertedIndex.description')}
        noRadio
        isChosen={value === RETRIEVE_METHOD.invertedIndex}
        onChosen={() => onChange(RETRIEVE_METHOD.invertedIndex)}
        chosenConfig={
          <RetrivalParamConfig
            type={RETRIEVE_METHOD.invertedIndex}
            value={{}}
            onChange={() => {}}
          />
        }
      />
    </div>
  )
}
export default React.memo(EconomicalRetrievalMethodConfig)
