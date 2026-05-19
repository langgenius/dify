'use client'

import type { App } from '@/models/explore'
import * as React from 'react'
import AppIcon from '@/app/components/base/app-icon'

type LearnDifyItemProps = {
  item: App
}

const LearnDifyItem = ({
  item,
}: LearnDifyItemProps) => {
  const appBasicInfo = item.app

  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg px-4 py-3 shadow-md">
      <div className="flex items-center gap-3">
        <AppIcon
          size="large"
          iconType={appBasicInfo.icon_type}
          icon={appBasicInfo.icon}
          background={appBasicInfo.icon_background}
          imageUrl={appBasicInfo.icon_url}
        />
        <h3 className="line-clamp-2 min-h-10 min-w-0 flex-1 system-md-semibold text-text-secondary" title={appBasicInfo.name}>
          {appBasicInfo.name}
        </h3>
      </div>
      <p className="mt-3 line-clamp-2 min-h-8 system-xs-regular text-text-tertiary">
        {item.description}
      </p>
    </article>
  )
}

export default React.memo(LearnDifyItem)
