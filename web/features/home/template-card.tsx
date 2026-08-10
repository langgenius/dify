'use client'
import type { RecommendedAppResponse } from '@dify/contracts/api/console/explore/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { AppTypeIcon } from '@/app/components/app/type-selector'
import { trackEvent } from '@/app/components/base/amplitude'
import AppIcon from '@/app/components/base/app-icon'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { AppModeEnum } from '@/types/app'

type TemplateCardProps = {
  app: RecommendedAppResponse
  canCreate: boolean
  onCreate: () => void
  onTry: (app: RecommendedAppResponse) => void
}

export function TemplateCard({ app, canCreate, onCreate, onTry }: TemplateCardProps) {
  const { t } = useTranslation()
  const { data: deploymentEdition } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ deployment_edition }) => deployment_edition,
  })
  const nameId = useId()
  const descriptionId = useId()
  const appBasicInfo = app.app
  const appName = appBasicInfo?.name ?? ''
  const appMode = appBasicInfo?.mode ?? ''
  const appIconType =
    appBasicInfo?.icon_type === 'image' ||
    appBasicInfo?.icon_type === 'emoji' ||
    appBasicInfo?.icon_type === 'link'
      ? appBasicInfo.icon_type
      : null
  const canViewApp = deploymentEdition === 'CLOUD'
  const isClickable = canViewApp || canCreate
  const handleTryApp = () => {
    trackEvent('preview_template', {
      template_id: app.app_id,
      template_name: appName,
      template_mode: appMode,
      template_categories: app.categories ?? [],
      page: 'explore',
    })
    onTry(app)
  }
  const handleCardClick = () => {
    if (canViewApp) {
      handleTryApp()
      return
    }

    if (canCreate) onCreate()
  }

  return (
    <div
      className={cn(
        'group relative col-span-1 flex h-35.5 flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg pb-3 text-left shadow-xs shadow-shadow-shadow-3',
        isClickable && 'cursor-pointer',
      )}
    >
      {isClickable && (
        <button
          type="button"
          className="absolute inset-0 z-10 cursor-pointer appearance-none rounded-xl border-0 bg-transparent p-0 outline-hidden focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid"
          aria-labelledby={nameId}
          aria-describedby={app.description ? descriptionId : undefined}
          onClick={handleCardClick}
        />
      )}
      <div className="flex shrink-0 items-center gap-3 px-4 pt-4 pb-2">
        <div className="relative shrink-0">
          <AppIcon
            size="large"
            iconType={appIconType}
            icon={appBasicInfo?.icon ?? undefined}
            background={appBasicInfo?.icon_background ?? undefined}
            imageUrl={appBasicInfo?.icon_url ?? undefined}
          />
          <AppTypeIcon
            wrapperClassName="absolute -right-0.5 -bottom-0.5 size-4 rounded-sm border-components-panel-on-panel-item-bg shadow-sm"
            className="size-3"
            type={appMode}
          />
        </div>
        <div className="flex w-0 grow flex-col gap-1 py-px">
          <div className="flex items-center system-md-semibold text-text-secondary">
            <div id={nameId} className="truncate" title={appName}>
              {appName}
            </div>
          </div>
          <div className="flex items-center system-2xs-medium-uppercase text-text-tertiary">
            {appMode === AppModeEnum.ADVANCED_CHAT && (
              <div className="truncate">
                {t(($) => $['types.advanced'], { ns: 'app' }).toUpperCase()}
              </div>
            )}
            {appMode === AppModeEnum.CHAT && (
              <div className="truncate">
                {t(($) => $['types.chatbot'], { ns: 'app' }).toUpperCase()}
              </div>
            )}
            {appMode === AppModeEnum.AGENT_CHAT && (
              <div className="truncate">
                {t(($) => $['types.agent'], { ns: 'app' }).toUpperCase()}
              </div>
            )}
            {appMode === AppModeEnum.WORKFLOW && (
              <div className="truncate">
                {t(($) => $['types.workflow'], { ns: 'app' }).toUpperCase()}
              </div>
            )}
            {appMode === AppModeEnum.COMPLETION && (
              <div className="truncate">
                {t(($) => $['types.completion'], { ns: 'app' }).toUpperCase()}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-start px-4 py-1">
        <div
          id={descriptionId}
          className="line-clamp-2 min-h-8 flex-1 system-xs-regular text-text-tertiary"
        >
          {app.description}
        </div>
      </div>
    </div>
  )
}
