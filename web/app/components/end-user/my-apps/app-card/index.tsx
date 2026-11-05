'use client'

import type { EndUserApp } from '../model'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@langgenius/dify-ui/menu'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AppTypeIcon, AppTypeLabel } from '@/app/components/app/type-selector'
import AppIcon from '@/app/components/base/app-icon'
import { webAppQuery } from '@/service/webapp'
import { getEndUserAppHref } from '../../app-link'

type Props = {
  app: EndUserApp
  authSession: number
}

export default function EndUserAppCard({ app, authSession }: Props) {
  const { t } = useTranslation(['app', 'common'])
  const context = { authSession, silent: true }
  const favorite = useMutation(
    webAppQuery.me.apps.byAppId.favorite.put.mutationOptions({
      context,
    }),
  )
  const unfavorite = useMutation(
    webAppQuery.me.apps.byAppId.favorite.delete.mutationOptions({
      context,
    }),
  )
  const removeApp = useMutation(
    webAppQuery.me.apps.byAppId.delete.mutationOptions({
      context,
    }),
  )
  const pending = favorite.isPending || unfavorite.isPending || removeApp.isPending
  const error = favorite.error ?? unfavorite.error ?? removeApp.error
  const resetErrors = () => {
    favorite.reset()
    unfavorite.reset()
    removeApp.reset()
  }

  return (
    <li className="relative flex min-w-0 flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg pb-3 shadow-xs hover:bg-components-panel-on-panel-item-bg-hover">
      <div className="flex items-center gap-3 px-4 pt-4 pb-2">
        <div className="relative" aria-hidden="true">
          <AppIcon size="large" icon={app} decorative />
          <AppTypeIcon
            type={app.mode}
            wrapperClassName="absolute -right-0.5 -bottom-0.5 size-4 rounded-md"
            className="size-3"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1 py-px">
          <h2 className="system-md-semibold text-text-secondary">
            <a
              href={getEndUserAppHref(app)}
              className="text-start wrap-anywhere outline-hidden after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-state-accent-solid"
            >
              {app.name}
            </a>
          </h2>
          <AppTypeLabel type={app.mode} className="system-2xs-medium text-text-tertiary" />
        </div>
      </div>
      <p className="min-h-10 grow px-4 py-1 system-xs-regular wrap-anywhere text-text-tertiary">
        {app.description}
      </p>
      <div className="flex min-h-9.5 items-center justify-end gap-1 px-4 pt-2">
        <IconButton
          size="md"
          className="relative size-7"
          disabled={pending}
          focusableWhenDisabled
          aria-pressed={app.is_favorite}
          aria-label={
            app.is_favorite
              ? t(($) => $['endUser.unstarApp'], { ns: 'app', name: app.name })
              : t(($) => $['endUser.starApp'], { ns: 'app', name: app.name })
          }
          onClick={() => {
            resetErrors()
            if (app.is_favorite) unfavorite.mutate({ params: { app_id: app.id } })
            else favorite.mutate({ params: { app_id: app.id } })
          }}
        >
          <span
            className={cn(
              'size-4',
              pending
                ? 'i-ri-loader-4-line animate-spin'
                : app.is_favorite
                  ? 'i-ri-star-fill text-util-colors-yellow-yellow-500'
                  : 'i-ri-star-line',
            )}
            aria-hidden="true"
          />
        </IconButton>
        <Menu>
          <MenuTrigger
            disabled={pending}
            render={
              <IconButton
                size="md"
                className="relative size-7"
                aria-label={t(($) => $['endUser.appActions'], { ns: 'app', name: app.name })}
              >
                <span
                  className={
                    removeApp.isPending
                      ? 'i-ri-loader-4-line size-4 animate-spin'
                      : 'i-ri-more-fill size-4'
                  }
                  aria-hidden="true"
                />
              </IconButton>
            }
          />
          <MenuContent className="min-w-54.5" side="bottom" align="end">
            <MenuItem
              disabled={pending}
              onClick={() => {
                resetErrors()
                removeApp.mutate({ params: { app_id: app.id } })
              }}
            >
              {t(($) => $['endUser.removeFromList'], { ns: 'app' })}
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
      {error && (
        <p role="alert" className="px-4 system-xs-regular text-text-destructive">
          {error.message || t(($) => $['api.actionFailed'], { ns: 'common' })}
        </p>
      )}
    </li>
  )
}
