'use client'

import type { NetworkAccessGroupResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { AppIconType } from '@/types/app'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'

type PolicyReferencedAppsProps = {
  apps: NetworkAccessGroupResponse['apps']
  usedByCount: number
}

function toAppIconType(iconType: string | null | undefined): AppIconType | undefined {
  if (iconType === 'image' || iconType === 'emoji' || iconType === 'link') return iconType
}

export function PolicyReferencedApps({ apps, usedByCount }: PolicyReferencedAppsProps) {
  const { t } = useTranslation()

  if (apps.length === 0) {
    if (usedByCount <= 0) return null

    return (
      <p className="system-sm-regular text-text-tertiary">
        {t(($) => $['settings.ipPolicyUsedBy'], { ns: 'common', count: usedByCount })}
      </p>
    )
  }

  return (
    <ul className="flex flex-wrap content-start items-start gap-2">
      {apps.map((app) => (
        <li key={app.id}>
          <a
            href={`/app/${app.id}/overview`}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-7 items-center gap-1.5 rounded-md border border-components-panel-border-subtle bg-background-default py-1 pr-1.5 pl-1 outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          >
            <AppIcon
              size="xs"
              decorative
              iconType={toAppIconType(app.icon_type)}
              icon={app.icon ?? undefined}
              background={app.icon_background}
              className="size-5 rounded-sm"
            />
            <span className="system-sm-medium whitespace-nowrap text-text-primary">{app.name}</span>
            <span
              aria-hidden
              className="i-ri-arrow-right-up-line size-3.5 shrink-0 text-text-tertiary"
            />
          </a>
        </li>
      ))}
    </ul>
  )
}
