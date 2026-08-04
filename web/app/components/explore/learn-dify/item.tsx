'use client'

import type { App } from '@/models/explore'
import type { TryAppSelection } from '@/types/try-app'
import { cn } from '@langgenius/dify-ui/cn'
import { useSuspenseQuery } from '@tanstack/react-query'
import * as React from 'react'
import { trackEvent } from '@/app/components/base/amplitude'
import AppIcon from '@/app/components/base/app-icon'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'

type LearnDifyItemProps = {
  canCreate: boolean
  item: App
  onCreate?: (app: App) => void
  onTry?: (params: TryAppSelection) => void
}

const LearnDifyItem = ({ canCreate, item, onCreate, onTry }: LearnDifyItemProps) => {
  const { data: deploymentEdition } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ deployment_edition }) => deployment_edition,
  })
  const appNameId = React.useId()
  const appDescriptionId = React.useId()
  const appBasicInfo = item.app
  const canViewApp = deploymentEdition === 'CLOUD'
  const canShowCreate = canCreate && !!onCreate
  const isClickable = canViewApp || canShowCreate

  const handleTryApp = () => {
    trackEvent('preview_template', {
      template_id: item.app_id,
      template_name: appBasicInfo.name,
      template_mode: appBasicInfo.mode,
      template_categories: item.categories,
      page: 'explore',
    })
    onTry?.({ appId: item.app_id, app: item })
  }
  const handleCardClick = () => {
    if (canViewApp) {
      handleTryApp()
      return
    }

    if (canShowCreate) onCreate?.(item)
  }

  return (
    <article
      className={cn(
        'relative flex min-w-0 flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg px-4 pt-4 pb-4 text-left shadow-xs',
        isClickable && 'cursor-pointer',
      )}
    >
      {isClickable && (
        <button
          type="button"
          className="absolute inset-0 z-10 cursor-pointer touch-manipulation appearance-none rounded-xl border-0 bg-transparent p-0 outline-hidden focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid"
          aria-labelledby={appNameId}
          aria-describedby={item.description ? appDescriptionId : undefined}
          onClick={handleCardClick}
        />
      )}
      <div className="flex flex-col items-start gap-2 pb-1">
        <AppIcon
          size="large"
          iconType={appBasicInfo.icon_type}
          icon={appBasicInfo.icon}
          background={appBasicInfo.icon_background}
          imageUrl={appBasicInfo.icon_url}
        />
        <h3 id={appNameId} className="w-full truncate system-md-semibold text-text-secondary">
          {appBasicInfo.name}
        </h3>
      </div>
      <p
        id={appDescriptionId}
        className="line-clamp-2 min-h-8 system-xs-regular text-text-tertiary"
      >
        {item.description}
      </p>
    </article>
  )
}

export default React.memo(LearnDifyItem)
