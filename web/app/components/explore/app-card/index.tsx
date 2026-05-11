'use client'
import type { App } from '@/models/explore'
import type { TryAppSelection } from '@/types/try-app'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import AppIcon from '@/app/components/base/app-icon'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { AppModeEnum } from '@/types/app'
import { AppTypeIcon } from '../../app/type-selector'

export type AppCardProps = {
  app: App
  canCreate: boolean
  onCreate: () => void
  onTry: (params: TryAppSelection) => void
  isExplore?: boolean
}

const AppCard = ({
  app,
  canCreate,
  onCreate,
  onTry,
  isExplore = true,
}: AppCardProps) => {
  const { t } = useTranslation()
  const { app: appBasicInfo } = app
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const isTrialApp = app.can_trial && systemFeatures.enable_trial_app
  const handleTryApp = () => {
    trackEvent('preview_template', {
      template_id: app.app_id,
      template_name: appBasicInfo.name,
      template_mode: appBasicInfo.mode,
      template_categories: app.categories,
      page: 'explore',
    })
    onTry({ appId: app.app_id, app })
  }

  return (
    <div className="group relative col-span-1 flex h-[142px] cursor-pointer flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg pb-3 shadow-xs shadow-shadow-shadow-3">
      <div className="flex shrink-0 items-center gap-3 px-4 pt-4 pb-2">
        <div className="relative shrink-0">
          <AppIcon
            size="large"
            iconType={appBasicInfo.icon_type}
            icon={appBasicInfo.icon}
            background={appBasicInfo.icon_background}
            imageUrl={appBasicInfo.icon_url}
          />
          <AppTypeIcon
            wrapperClassName="absolute -right-0.5 -bottom-0.5 size-4 rounded-sm border-components-panel-on-panel-item-bg shadow-sm"
            className="size-3"
            type={appBasicInfo.mode}
          />
        </div>
        <div className="flex w-0 grow flex-col gap-1 py-px">
          <div className="flex items-center system-md-semibold text-text-secondary">
            <div className="truncate" title={appBasicInfo.name}>{appBasicInfo.name}</div>
          </div>
          <div className="flex items-center system-2xs-medium-uppercase text-text-tertiary">
            {appBasicInfo.mode === AppModeEnum.ADVANCED_CHAT && <div className="truncate">{t('types.advanced', { ns: 'app' }).toUpperCase()}</div>}
            {appBasicInfo.mode === AppModeEnum.CHAT && <div className="truncate">{t('types.chatbot', { ns: 'app' }).toUpperCase()}</div>}
            {appBasicInfo.mode === AppModeEnum.AGENT_CHAT && <div className="truncate">{t('types.agent', { ns: 'app' }).toUpperCase()}</div>}
            {appBasicInfo.mode === AppModeEnum.WORKFLOW && <div className="truncate">{t('types.workflow', { ns: 'app' }).toUpperCase()}</div>}
            {appBasicInfo.mode === AppModeEnum.COMPLETION && <div className="truncate">{t('types.completion', { ns: 'app' }).toUpperCase()}</div>}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-start px-4 py-1">
        <div className="line-clamp-2 min-h-8 flex-1 system-xs-regular text-text-tertiary">
          {app.description}
        </div>
      </div>
      <div className="relative flex h-[26px] w-full shrink-0 flex-col gap-2 overflow-hidden px-3">
        <div className="flex w-full shrink-0 items-center gap-1 rounded-lg p-1">
          {app.categories.slice(0, 2).map(category => (
            <div key={category} className="flex min-w-[18px] shrink-0 items-center justify-center gap-0.5 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-[5px] py-[3px] system-2xs-medium-uppercase text-text-tertiary">
              <span className="i-custom-vender-line-financeAndECommerce-tag-01 size-3 shrink-0" />
              <span className="whitespace-nowrap">{category}</span>
            </div>
          ))}
        </div>
        <div className="pointer-events-none absolute top-0 right-0 bottom-0 w-20 bg-linear-to-r from-components-card-bg-alt-transparent to-components-card-bg-alt" />
      </div>
      {isExplore && (canCreate || isTrialApp) && (
        <div className={cn('absolute right-0 bottom-0 left-0 hidden bg-linear-to-t from-components-panel-gradient-2 from-[60.27%] to-transparent p-4 pt-8 group-hover:flex')}>
          <div className={cn('grid h-8 w-full grid-cols-1 space-x-2', canCreate && 'grid-cols-2')}>
            {
              canCreate && (
                <Button variant="primary" className="h-7" onClick={() => onCreate()}>
                  <span className="mr-1 i-heroicons-plus-20-solid h-4 w-4" />
                  <span className="text-xs">{t('appCard.addToWorkspace', { ns: 'explore' })}</span>
                </Button>
              )
            }
            <Button className="h-7" onClick={handleTryApp}>
              <span className="mr-1 i-ri-information-2-line size-4" />
              <span>{t('appCard.try', { ns: 'explore' })}</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default AppCard
