'use client'
import type { App } from '@/models/explore'
import { PlusIcon } from '@heroicons/react/20/solid'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { RiInformation2Line } from '@remixicon/react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useContextSelector } from 'use-context-selector'
import { trackEvent } from '@/app/components/base/amplitude'
import AppIcon from '@/app/components/base/app-icon'
import AppListContext from '@/context/app-list-context'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { AppTypeIcon, AppTypeLabel } from '../../type-selector'

type AppCardProps = {
  app: App
  canCreate: boolean
  onCreate: () => void
}

const AppCard = ({
  app,
  canCreate,
  onCreate,
}: AppCardProps) => {
  const { t } = useTranslation()
  const { app: appBasicInfo } = app
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const isTrialApp = app.can_trial && systemFeatures.enable_trial_app
  const setShowTryAppPanel = useContextSelector(AppListContext, ctx => ctx.setShowTryAppPanel)
  const handleShowTryAppPanel = useCallback(() => {
    trackEvent('preview_template', {
      template_id: app.app_id,
      template_name: appBasicInfo.name,
      template_mode: appBasicInfo.mode,
      template_categories: app.categories,
      page: 'studio',
    })
    setShowTryAppPanel?.(true, { appId: app.app_id, app })
  }, [setShowTryAppPanel, app, appBasicInfo])
  return (
    <div className={cn('group relative flex h-[132px] cursor-pointer flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-4 shadow-xs hover:shadow-lg')}>
      <div className="flex shrink-0 grow-0 items-center gap-3 pb-2">
        <div className="relative shrink-0">
          <AppIcon
            size="large"
            iconType={appBasicInfo.icon_type}
            icon={appBasicInfo.icon}
            background={appBasicInfo.icon_background}
            imageUrl={appBasicInfo.icon_url}
          />
          <AppTypeIcon
            wrapperClassName="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-sm border border-divider-regular outline-solid outline-components-panel-on-panel-item-bg"
            className="h-3 w-3"
            type={appBasicInfo.mode}
          />
        </div>
        <div className="flex grow flex-col gap-1">
          <div className="line-clamp-1">
            <span className="system-md-semibold text-text-secondary" title={appBasicInfo.name}>{appBasicInfo.name}</span>
          </div>
          <AppTypeLabel className="system-2xs-medium-uppercase text-text-tertiary" type={app.app.mode} />
        </div>
      </div>
      <div className="py-1 system-xs-regular text-text-tertiary">
        <div className="line-clamp-3">
          {app.description}
        </div>
      </div>
      {(canCreate || isTrialApp) && (
        <div className={cn('absolute right-0 bottom-0 left-0 hidden bg-linear-to-t from-components-panel-gradient-2 from-[60.27%] to-transparent p-4 pt-8 group-hover:flex')}>
          <div className={cn('grid h-8 w-full grid-cols-1 items-center space-x-2', canCreate && 'grid-cols-2')}>
            {canCreate && (
              <Button variant="primary" onClick={() => onCreate()}>
                <PlusIcon className="mr-1 h-4 w-4" />
                <span className="text-xs">{t('newApp.useTemplate', { ns: 'app' })}</span>
              </Button>
            )}
            <Button onClick={handleShowTryAppPanel}>
              <RiInformation2Line className="mr-1 size-4" />
              <span>{t('appCard.try', { ns: 'explore' })}</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default AppCard
