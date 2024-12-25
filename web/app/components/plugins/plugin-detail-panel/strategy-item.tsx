'use client'
import React, { useState } from 'react'
import { useContext } from 'use-context-selector'
import type {
  StrategyDetail,
} from '@/app/components/plugins/types'
import I18n from '@/context/i18n'
import { getLanguage } from '@/i18n/language'
import cn from '@/utils/classnames'

type Props = {
  detail: StrategyDetail
}

const StrategyItem = ({
  detail,
}: Props) => {
  const { locale } = useContext(I18n)
  const language = getLanguage(locale)
  const [showDetail, setShowDetail] = useState(false)

  return (
    <>
      <div
        className={cn('mb-2 px-4 py-3 bg-components-panel-item-bg rounded-xl border-[0.5px] border-components-panel-border-subtle shadow-xs cursor-pointer hover:bg-components-panel-on-panel-item-bg-hover')}
        onClick={() => setShowDetail(true)}
      >
        <div className='pb-0.5 text-text-secondary system-md-semibold'>{detail.identity.label[language]}</div>
        <div className='text-text-tertiary system-xs-regular line-clamp-2' title={detail.description[language]}>{detail.description[language]}</div>
      </div>
    </>
  )
}
export default StrategyItem
