'use client'

import type { KeyboardEvent } from 'react'
import type { App } from '@/models/explore'
import type { TryAppSelection } from '@/types/try-app'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { trackEvent } from '@/app/components/base/amplitude'
import AppIcon from '@/app/components/base/app-icon'
import { IS_CLOUD_EDITION } from '@/config'

type LearnDifyItemProps = {
  canCreate: boolean
  item: App
  onCreate?: (app: App) => void
  onTry?: (params: TryAppSelection) => void
}

const LearnDifyItem = ({
  canCreate,
  item,
  onCreate,
  onTry,
}: LearnDifyItemProps) => {
  const appBasicInfo = item.app
  const canViewApp = IS_CLOUD_EDITION
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
    if (IS_CLOUD_EDITION) {
      handleTryApp()
      return
    }

    if (canShowCreate)
      onCreate?.(item)
  }
  const handleCardKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ')
      return

    event.preventDefault()
    handleCardClick()
  }

  return (
    <article
      className={cn(
        'relative flex min-w-0 flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg px-4 pt-4 pb-4 shadow-xs',
        isClickable && 'cursor-pointer',
      )}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      aria-label={isClickable ? appBasicInfo.name : undefined}
      onClick={isClickable ? handleCardClick : undefined}
      onKeyDown={isClickable ? handleCardKeyDown : undefined}
    >
      <div className="flex flex-col items-start gap-2 pb-1">
        <AppIcon
          size="large"
          iconType={appBasicInfo.icon_type}
          icon={appBasicInfo.icon}
          background={appBasicInfo.icon_background}
          imageUrl={appBasicInfo.icon_url}
        />
        <h3 className="w-full truncate system-md-semibold text-text-secondary">
          {appBasicInfo.name}
        </h3>
      </div>
      <p className="line-clamp-2 min-h-8 system-xs-regular text-text-tertiary">
        {item.description}
      </p>
    </article>
  )
}

export default React.memo(LearnDifyItem)
