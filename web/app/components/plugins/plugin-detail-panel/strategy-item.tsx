'use client'

import type {
  AgentStrategyEntity,
  AgentStrategyProviderIdentity,
} from '@dify/contracts/api/console/workspaces/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useId, useState } from 'react'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import StrategyDetailPanel from './strategy-detail'

type Props = Readonly<{
  provider: AgentStrategyProviderIdentity
  tenantId: string
  detail: AgentStrategyEntity
}>

const StrategyItem = ({ provider, tenantId, detail }: Props) => {
  const getValueFromI18nObject = useRenderI18nObject()
  const [showDetail, setShowDetail] = useState(false)
  const titleId = useId()
  const descriptionId = useId()
  const description = getValueFromI18nObject(detail.description)

  return (
    <>
      <button
        type="button"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          'bg-components-panel-item-bg mb-2 w-full cursor-pointer rounded-xl border-[0.5px] border-components-panel-border-subtle px-4 py-3 text-left shadow-xs outline-hidden hover:bg-components-panel-on-panel-item-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid',
        )}
        onClick={() => setShowDetail(true)}
      >
        <div id={titleId} className="pb-0.5 system-md-semibold text-text-secondary">
          {getValueFromI18nObject(detail.identity.label)}
        </div>
        <div id={descriptionId} className="line-clamp-2 system-xs-regular text-text-tertiary">
          {description}
        </div>
      </button>
      {showDetail && (
        <StrategyDetailPanel
          provider={provider}
          tenantId={tenantId}
          detail={detail}
          onHide={() => setShowDetail(false)}
        />
      )}
    </>
  )
}
export default StrategyItem
