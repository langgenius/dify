'use client'

import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'
import type { ReactNode } from 'react'
import AppIcon from '@/app/components/base/app-icon'
import { AppTypeIcon, AppTypeLabel } from './type-selector'

type AppCardSummaryProps = {
  app: Pick<
    AppPartial,
    'name' | 'mode' | 'icon' | 'icon_type' | 'icon_background' | 'icon_url' | 'description'
  >
  nameId?: string
  descriptionId?: string
  typeLabel?: ReactNode
  children?: ReactNode
}

export default function AppCardSummary({
  app,
  nameId,
  descriptionId,
  typeLabel,
  children,
}: AppCardSummaryProps) {
  return (
    <>
      <div className="flex shrink-0 items-center gap-3 px-4 pt-4 pb-2">
        <div className="relative shrink-0">
          <AppIcon size="large" icon={app} />
          <AppTypeIcon
            type={app.mode}
            wrapperClassName="absolute -bottom-0.5 -end-0.5 size-4 shadow-sm"
            className="size-3"
          />
        </div>
        <div className="flex w-0 grow flex-col gap-1 py-px">
          <div className="flex items-center text-sm/5 font-semibold text-text-secondary">
            <div id={nameId} className="truncate">
              {app.name}
            </div>
          </div>
          <div className="truncate system-2xs-medium-uppercase text-text-tertiary">
            {typeLabel ?? <AppTypeLabel type={app.mode} />}
          </div>
        </div>
        {children}
      </div>
      <div className="shrink-0 px-4 py-1 system-xs-regular text-text-tertiary">
        <div id={descriptionId} className="line-clamp-2 min-h-8">
          {app.description}
        </div>
      </div>
    </>
  )
}
