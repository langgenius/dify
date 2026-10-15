'use client'

import type { EndUserApp } from '../model'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { useTranslation } from 'react-i18next'
import { AppTypeIcon, AppTypeLabel } from '@/app/components/app/type-selector'
import AppIcon from '@/app/components/base/app-icon'
import AppActionsMenu from './actions-menu'

type Props = {
  app: EndUserApp
  onOpen: () => void
  onToggleStar: () => void
  onRemove: (deleteChats: boolean) => void
}

export default function EndUserAppCard({ app, onOpen, onToggleStar, onRemove }: Props) {
  const { t } = useTranslation(['app'])
  return (
    <li className="relative flex min-w-0 flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg pb-3 shadow-xs hover:bg-components-panel-on-panel-item-bg-hover">
      <div className="flex items-center gap-3 px-4 pt-4 pb-2">
        <div className="relative" aria-hidden="true">
          <AppIcon
            size="large"
            icon={app.icon}
            background={app.iconBackground}
            decorative
            innerIcon={
              app.iconUrl ? <img src={app.iconUrl} width={24} height={24} alt="" /> : undefined
            }
          />
          <AppTypeIcon
            type={app.mode}
            wrapperClassName="absolute -right-0.5 -bottom-0.5 size-4 rounded-md"
            className="size-3"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1 py-px">
          <h2 className="system-md-semibold text-text-secondary">
            <button
              type="button"
              onClick={onOpen}
              aria-label={t(($) => $['endUser.openApp'], { ns: 'app', name: app.name })}
              className="text-start wrap-anywhere outline-hidden after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-state-accent-solid"
            >
              {app.name}
            </button>
          </h2>
          <AppTypeLabel type={app.mode} className="system-2xs-medium text-text-tertiary" />
        </div>
      </div>
      <p className="min-h-10 grow px-4 py-1 system-xs-regular wrap-anywhere text-text-tertiary">
        {app.description}
      </p>
      <div className="flex min-h-9.5 items-center justify-between gap-1 px-4 pt-2">
        <div className="flex min-w-0 items-center gap-1.5 system-xs-semibold text-util-colors-warning-warning-600">
          {app.connectionStatus !== 'ready' && (
            <>
              <StatusDot status="warning" size="small" />
              {app.connectionStatus === 'not-configured'
                ? t(($) => $['endUser.notConfigured'], { ns: 'app' })
                : t(($) => $['endUser.actionRequired'], { ns: 'app' })}
            </>
          )}
        </div>
        <div className="relative flex shrink-0 items-center gap-1">
          <IconButton
            size="md"
            className="size-7"
            aria-pressed={app.starred}
            aria-label={
              app.starred
                ? t(($) => $['endUser.unstarApp'], { ns: 'app', name: app.name })
                : t(($) => $['endUser.starApp'], { ns: 'app', name: app.name })
            }
            onClick={onToggleStar}
          >
            <span
              className={cn(
                'size-4',
                app.starred
                  ? 'i-ri-star-fill text-util-colors-yellow-yellow-500'
                  : 'i-ri-star-line',
              )}
              aria-hidden="true"
            />
          </IconButton>
          <AppActionsMenu name={app.name} onRemove={onRemove} />
        </div>
      </div>
    </li>
  )
}
