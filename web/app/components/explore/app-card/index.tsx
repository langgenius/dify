'use client'
import type { App } from '@/models/explore'
import type { TryAppSelection } from '@/types/try-app'
import { cn } from '@langgenius/dify-ui/cn'
import { useId } from 'react'
import { useTranslation } from '#i18n'
import { trackEvent } from '@/app/components/base/amplitude'
import AppIcon from '@/app/components/base/app-icon'
import { IS_CLOUD_EDITION } from '@/config'
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
  const nameId = useId()
  const descriptionId = useId()
  const { app: appBasicInfo } = app
  const canViewApp = IS_CLOUD_EDITION
  const isClickable = isExplore && (canViewApp || canCreate)
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
  const handleCardClick = () => {
    if (IS_CLOUD_EDITION) {
      handleTryApp()
      return
    }

    if (canCreate)
      onCreate()
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
          className="absolute inset-0 z-10 cursor-pointer appearance-none rounded-xl border-0 bg-transparent p-0 outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-inset"
          aria-labelledby={nameId}
          aria-describedby={app.description ? descriptionId : undefined}
          onClick={handleCardClick}
        />
      )}
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
            <div id={nameId} className="truncate" title={appBasicInfo.name}>{appBasicInfo.name}</div>
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
        <div id={descriptionId} className="line-clamp-2 min-h-8 flex-1 system-xs-regular text-text-tertiary">
          {app.description}
        </div>
      </div>
    </div>
  )
}

export default AppCard
