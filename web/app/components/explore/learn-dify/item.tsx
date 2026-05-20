'use client'

import type { App } from '@/models/explore'
import type { TryAppSelection } from '@/types/try-app'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  const appBasicInfo = item.app
  const canViewApp = IS_CLOUD_EDITION
  const canShowCreate = canCreate && !!onCreate
  const showHoverActions = canShowCreate || canViewApp

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

  return (
    <article className="group relative flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg px-4 py-3 shadow-md">
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
      {showHoverActions && (
        <div className="absolute right-0 bottom-0 left-0 hidden bg-linear-to-t from-components-panel-gradient-2 from-[60.27%] to-transparent p-4 pt-8 group-hover:flex">
          <div className={cn('grid h-8 w-full gap-2', canShowCreate && canViewApp ? 'grid-cols-2' : 'grid-cols-1')}>
            {canShowCreate && (
              <Button variant="primary" className="h-7" onClick={() => onCreate?.(item)}>
                <span className="mr-1 i-heroicons-plus-20-solid size-4" />
                <span className="text-xs">{t('appCard.addToWorkspace', { ns: 'explore' })}</span>
              </Button>
            )}
            {canViewApp && (
              <Button className="h-7" onClick={handleTryApp}>
                <span className="mr-1 i-ri-information-2-line size-4" />
                <span>{t('appCard.try', { ns: 'explore' })}</span>
              </Button>
            )}
          </div>
        </div>
      )}
    </article>
  )
}

export default React.memo(LearnDifyItem)
