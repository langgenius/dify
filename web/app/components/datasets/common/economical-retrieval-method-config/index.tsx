'use client'
import type { FC } from 'react'
import type { RetrievalConfig } from '@/types/app'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { VectorSearch } from '@/app/components/base/icons/src/vender/knowledge'
import { RETRIEVE_METHOD } from '@/types/app'
import { EffectColor } from '../../settings/chunk-structure/types'
import OptionCard from '../../settings/option-card'
import RetrievalParamConfig from '../retrieval-param-config'

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
      icon={<VectorSearch className="size-4" />}
      iconActiveColor="text-util-colors-purple-purple-600"
      title={t('retrieval.keyword_search.title', { ns: 'dataset' })}
      description={t('retrieval.keyword_search.description', { ns: 'dataset' })}
      isActive
      effectColor={EffectColor.purple}
      showEffectColor
      showChildren
      className="gap-x-2"
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
