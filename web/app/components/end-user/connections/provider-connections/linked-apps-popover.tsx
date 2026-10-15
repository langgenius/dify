'use client'

import type { EndUserConnection } from '../model'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'

type Props = {
  connection: EndUserConnection
  connectionLabelId: string
}

export default function LinkedAppsPopover({ connection, connectionLabelId }: Props) {
  const { t } = useTranslation(['app'])

  return (
    <Popover>
      <PopoverTrigger
        aria-describedby={connectionLabelId}
        className="inline-flex min-h-6 items-center rounded-md system-xs-medium text-text-accent hover:underline"
      >
        {t(($) => $['endUser.linkedAppCount'], { ns: 'app', count: connection.apps.length })}
      </PopoverTrigger>
      <PopoverContent placement="bottom-start" className="w-64 max-w-[calc(100vw-2rem)] p-1">
        <PopoverTitle className="px-3 py-2 system-xs-semibold-uppercase text-text-tertiary">
          {t(($) => $['endUser.linkedApps'], { ns: 'app' })}
        </PopoverTitle>
        {connection.apps.length > 0 ? (
          <ul className="max-h-60 overflow-y-auto">
            {connection.apps.map((app) => (
              <li key={app.id}>
                <Link
                  href={app.href}
                  className="flex min-h-8 items-center justify-between gap-2 rounded-lg px-3 py-2 system-sm-regular text-text-secondary hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                >
                  <span className="min-w-0 wrap-anywhere">{app.name}</span>
                  <span
                    aria-hidden
                    className="i-ri-arrow-right-up-line size-4 shrink-0 text-text-tertiary"
                  />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-2 system-sm-regular text-text-tertiary">
            {t(($) => $['endUser.noLinkedApps'], { ns: 'app' })}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
