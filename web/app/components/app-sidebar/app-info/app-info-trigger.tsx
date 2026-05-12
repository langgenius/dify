import type { App, AppSSO } from '@/types/app'
import { cn } from '@langgenius/dify-ui/cn'
import { RiEqualizer2Line } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '../../base/app-icon'
import { getAppModeLabel } from './app-mode-labels'

type AppInfoTriggerProps = {
  appDetail: App & Partial<AppSSO>
  expand: boolean
  onClick: () => void
}

const AppInfoTrigger = ({ appDetail, expand, onClick }: AppInfoTriggerProps) => {
  const { t } = useTranslation()
  const modeLabel = getAppModeLabel(appDetail.mode, t)

  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full"
      aria-label={!expand ? `${appDetail.name} - ${modeLabel}` : undefined}
    >
      <div className="flex flex-col gap-2 rounded-lg p-1 hover:bg-state-base-hover">
        <div className="flex items-center gap-1">
          <div className={cn(!expand && 'ml-1')}>
            <AppIcon
              size={expand ? 'large' : 'small'}
              iconType={appDetail.icon_type}
              icon={appDetail.icon}
              background={appDetail.icon_background}
              imageUrl={appDetail.icon_url}
            />
          </div>
          {expand && (
            <div className="ml-auto flex items-center justify-center rounded-md p-0.5">
              <div className="flex h-5 w-5 items-center justify-center">
                <RiEqualizer2Line className="h-4 w-4 text-text-tertiary" />
              </div>
            </div>
          )}
        </div>
        {!expand && (
          <div className="flex items-center justify-center">
            <div className="flex h-5 w-5 items-center justify-center rounded-md p-0.5">
              <RiEqualizer2Line className="h-4 w-4 text-text-tertiary" />
            </div>
          </div>
        )}
        {expand && (
          <div className="flex flex-col items-start gap-1">
            <div className="flex w-full">
              <div className="truncate system-md-semibold whitespace-nowrap text-text-secondary">{appDetail.name}</div>
            </div>
            <div className="system-2xs-medium-uppercase whitespace-nowrap text-text-tertiary">
              {getAppModeLabel(appDetail.mode, t)}
            </div>
          </div>
        )}
      </div>
    </button>
  )
}

export default React.memo(AppInfoTrigger)
