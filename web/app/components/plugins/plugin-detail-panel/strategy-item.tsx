'use client'
import type {
  StrategyDetail,
} from '@/app/components/plugins/types'
import type { Locale } from '@/i18n-config'
import * as React from 'react'
import { useState } from 'react'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import { cn } from '@/utils/classnames'
import StrategyDetailPanel from './strategy-detail'

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
        className={cn('bg-components-panel-item-bg mb-2 cursor-pointer rounded-xl border-[0.5px] border-components-panel-border-subtle px-4 py-3 shadow-xs hover:bg-components-panel-on-panel-item-bg-hover')}
        onClick={() => setShowDetail(true)}
      >
        <div className="system-md-semibold pb-0.5 text-text-secondary">{getValueFromI18nObject(detail.identity.label)}</div>
        <div className="system-xs-regular line-clamp-2 text-text-tertiary" title={getValueFromI18nObject(detail.description)}>{getValueFromI18nObject(detail.description)}</div>
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
