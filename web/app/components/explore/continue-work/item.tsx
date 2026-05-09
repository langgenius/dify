'use client'

import type { ContinueWorkItem as ContinueWorkItemData } from './data'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AppTypeIcon } from '@/app/components/app/type-selector'
import AppIcon from '@/app/components/base/app-icon'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'

type ContinueWorkItemProps = {
  item: ContinueWorkItemData
}

const ContinueWorkItem = ({
  item,
}: ContinueWorkItemProps) => {
  const { t } = useTranslation()
  const { formatTimeFromNow } = useFormatTimeFromNow()

  return (
    <article className="flex min-w-0 items-center gap-3 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg px-4 pt-4 pb-3 shadow-md">
      <div className="relative shrink-0">
        <AppIcon
          size="large"
          iconType={item.icon_type}
          icon={item.icon}
          background={item.icon_background}
          imageUrl={item.icon_url}
        />
        <AppTypeIcon
          type={item.mode}
          wrapperClassName="absolute -right-0.5 -bottom-0.5 size-4 rounded-xs border-components-panel-on-panel-item-bg shadow-sm"
          className="size-3"
        />
      </div>
      <div className="min-w-0 py-px">
        <h3 className="truncate system-md-semibold text-text-secondary" title={item.title}>
          {item.title}
        </h3>
        <div className="flex min-w-0 items-center gap-1 system-xs-regular text-text-tertiary">
          <span className="shrink-0">{item.author}</span>
          <span className="shrink-0">·</span>
          <span className="min-w-0 truncate">{t('continueWork.editedAt', { ns: 'explore', time: formatTimeFromNow(item.updatedAt) })}</span>
        </div>
      </div>
    </article>
  )
}

export default React.memo(ContinueWorkItem)
