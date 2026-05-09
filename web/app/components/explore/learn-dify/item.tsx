'use client'

import type { LearnDifyItem as LearnDifyItemData } from './data'
import * as React from 'react'
import AppIcon from '@/app/components/base/app-icon'

type LearnDifyItemProps = {
  item: LearnDifyItemData
}

const LearnDifyItem = ({
  item,
}: LearnDifyItemProps) => {
  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg px-4 py-3 shadow-md">
      <div className="flex items-center gap-3">
        <AppIcon
          size="large"
          iconType={item.icon_type}
          icon={item.icon}
          background={item.icon_background}
          imageUrl={item.icon_url}
        />
        <h3 className="line-clamp-2 min-h-10 min-w-0 flex-1 system-md-semibold text-text-secondary" title={item.title}>
          {item.title}
        </h3>
      </div>
      <p className="mt-3 line-clamp-2 min-h-8 system-xs-regular text-text-tertiary">
        {item.description}
      </p>
    </article>
  )
}

export default React.memo(LearnDifyItem)
