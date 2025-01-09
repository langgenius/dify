'use client'
import React, { useState } from 'react'
import StrategyDetailPanel from './strategy-detail'
import type {
  StrategyDetail,
} from '@/app/components/plugins/types'
import type { Locale } from '@/i18n'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import cn from '@/utils/classnames'

type Props = {
  provider: {
    author: string
    name: string
    description: Record<Locale, string>
    tenant_id: string
    icon: string
    label: Record<Locale, string>
    tags: string[]
  }
  detail: StrategyDetail
}

const StrategyItem = ({
  provider,
  detail,
}: Props) => {
  const getValueFromI18nObject = useRenderI18nObject()
  const [showDetail, setShowDetail] = useState(false)

  return (
    <>
      <div
        className={cn('mb-2 px-4 py-3 bg-components-panel-item-bg rounded-xl border-[0.5px] border-components-panel-border-subtle shadow-xs cursor-pointer hover:bg-components-panel-on-panel-item-bg-hover')}
        onClick={() => setShowDetail(true)}
      >
        <div className='pb-0.5 text-text-secondary system-md-semibold'>{getValueFromI18nObject(detail.identity.label)}</div>
        <div className='text-text-tertiary system-xs-regular line-clamp-2' title={getValueFromI18nObject(detail.description)}>{getValueFromI18nObject(detail.description)}</div>
      </div>
      {showDetail && (
        <StrategyDetailPanel
          provider={provider}
          detail={detail}
          onHide={() => setShowDetail(false)}
        />
      )}
    </>
  )
}
export default StrategyItem
