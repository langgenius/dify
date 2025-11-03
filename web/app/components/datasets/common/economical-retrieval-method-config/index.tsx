'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import RetrievalParamConfig from '../retrieval-param-config'
import { RETRIEVE_METHOD } from '@/types/app'
import type { RetrievalConfig } from '@/types/app'
import OptionCard from '../../settings/option-card'
import { VectorSearch } from '@/app/components/base/icons/src/vender/knowledge'
import { EffectColor } from '../../settings/chunk-structure/types'

type Props = {
  disabled?: boolean
  value: RetrievalConfig
  onChange: (value: RetrievalConfig) => void
}

const EconomicalRetrievalMethodConfig: FC<Props> = ({
  disabled = false,
  value,
  onChange,
}) => {
  const { t } = useTranslation()

  return (
    <OptionCard
      id={RETRIEVE_METHOD.keywordSearch}
      disabled={disabled}
      icon={<VectorSearch className='size-4' />}
      iconActiveColor='text-util-colors-purple-purple-600'
      title={t('dataset.retrieval.keyword_search.title')}
      description={t('dataset.retrieval.keyword_search.description')}
      isActive
      effectColor={EffectColor.purple}
      showEffectColor
      showChildren
      className='gap-x-2'
    >
      <RetrievalParamConfig
        type={RETRIEVE_METHOD.keywordSearch}
        value={value}
        onChange={onChange}
      />
    </OptionCard>
  )
}
export default React.memo(EconomicalRetrievalMethodConfig)
