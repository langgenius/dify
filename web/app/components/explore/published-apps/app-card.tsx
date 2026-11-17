'use client'

import type { InstalledAppResponse } from '@dify/contracts/api/console/installed-apps/types.gen'
import type { DialogHandle } from '@langgenius/dify-ui/dialog'
import { cn } from '@langgenius/dify-ui/cn'
import { DialogTrigger } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import AppCardSummary from '@/app/components/app/app-card-summary'
import ItemOperation from '@/app/components/explore/item-operation'
import { consoleQuery } from '@/service/console'

type Props = {
  app: InstalledAppResponse
  dialog: DialogHandle<string>
}

export default function PublishedAppCard({ app, dialog }: Props) {
  const { t } = useTranslation(['app'])
  const pin = useMutation(
    consoleQuery.installedApps.byInstalledAppId.patch.mutationOptions({
      context: { silent: true },
    }),
  )
  const togglePin = () => {
    if (pin.isPending) return
    pin.mutate({
      params: { installed_app_id: app.id },
      body: { is_pinned: !app.is_pinned },
    })
  }

  return (
    <li className="group relative flex min-w-0 flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg pb-3 shadow-xs hover:bg-components-panel-on-panel-item-bg-hover">
      <DialogTrigger
        handle={dialog}
        payload={app.id}
        aria-label={app.app.name}
        className="text-start outline-hidden after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-state-accent-solid"
      >
        <AppCardSummary app={app.app} />
      </DialogTrigger>
      <div className="mt-auto flex min-h-9.5 items-center justify-end gap-1 px-4 pt-2">
        <IconButton
          size="md"
          className="relative size-7"
          disabled={pin.isPending}
          aria-pressed={app.is_pinned}
          aria-label={
            app.is_pinned
              ? t(($) => $['endUser.unstarApp'], { ns: 'app', name: app.app.name })
              : t(($) => $['endUser.starApp'], { ns: 'app', name: app.app.name })
          }
          onClick={togglePin}
        >
          <span
            aria-hidden
            className={cn(
              'size-4',
              pin.isPending
                ? 'i-ri-loader-4-line animate-spin'
                : app.is_pinned
                  ? 'i-ri-star-fill text-util-colors-yellow-yellow-500'
                  : 'i-ri-star-line',
            )}
          />
        </IconButton>
        <div className="relative">
          <ItemOperation
            className="[&>span]:opacity-100"
            itemName={app.app.name}
            isPinned={app.is_pinned}
            togglePin={togglePin}
          />
        </div>
      </div>
      {pin.error && (
        <p role="alert" className="px-4 system-xs-regular text-text-destructive">
          {pin.error.message}
        </p>
      )}
    </li>
  )
}
