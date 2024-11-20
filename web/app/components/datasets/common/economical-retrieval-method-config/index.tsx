'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import RetrievalParamConfig from '../retrieval-param-config'
import { OptionCard } from '../../create/step-two/option-card'
import { RETRIEVE_METHOD } from '@/types/app'
import type { RetrievalConfig } from '@/types/app'
import { HighPriority } from '@/app/components/base/icons/src/vender/solid/arrows'

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
      <OptionCard icon={<HighPriority className='w-4 h-4 text-[#7839EE]' />}
        title={t('dataset.retrieval.invertedIndex.title')}
        description={t('dataset.retrieval.invertedIndex.description')} isActive>
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
