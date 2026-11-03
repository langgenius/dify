'use client'

import type { ConnectionAuthSource, ConnectionAuthState } from './mock-data'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'

export default function ConnectionAuthIssue({
  state,
  source,
  requester,
}: {
  state: Exclude<ConnectionAuthState, 'setup'>
  source: ConnectionAuthSource
  requester: string
}) {
  const { t } = useTranslation(['share'])
  const expired = state === 'expired'
  const title = expired
    ? t(($) => $['connections.headless.expiredTitle'], { ns: 'share' })
    : t(($) => $['connections.headless.configurationChangedTitle'], { ns: 'share' })

  let description: string
  if (expired) {
    description =
      source === 'api'
        ? t(($) => $['connections.headless.apiExpiredDescription'], {
            ns: 'share',
            source: requester,
          })
        : t(($) => $['connections.headless.expiredDescription'], { ns: 'share' })
  } else {
    description =
      source === 'api'
        ? t(($) => $['connections.headless.apiConfigurationChangedDescription'], {
            ns: 'share',
            source: requester,
          })
        : t(($) => $['connections.headless.configurationChangedDescription'], { ns: 'share' })
  }

  return (
    <div role="alert" className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 title-3xl-semi-bold text-text-primary">
        <span
          aria-hidden="true"
          className={cn(
            'size-5 shrink-0',
            expired
              ? 'i-ri-error-warning-fill text-text-destructive'
              : 'i-ri-alert-fill text-text-warning-secondary',
          )}
        />
        {title}
      </h2>
      <p className="system-md-regular text-text-secondary">{description}</p>
    </div>
  )
}
