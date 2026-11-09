'use client'

import type { ConnectionAuthState } from './mock-data'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'

export default function ConnectionAuthIssue({
  state,
  requester,
}: {
  state: Exclude<ConnectionAuthState, 'setup'>
  requester: string
}) {
  const { t } = useTranslation(['share'])
  const expired = state === 'expired'
  const title = expired
    ? t(($) => $['connections.headless.expiredTitle'], { ns: 'share' })
    : t(($) => $['connections.headless.configurationChangedTitle'], { ns: 'share' })

  const description = expired
    ? t(($) => $['connections.headless.apiExpiredDescription'], {
        ns: 'share',
        source: requester,
      })
    : t(($) => $['connections.headless.apiConfigurationChangedDescription'], {
        ns: 'share',
        source: requester,
      })

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
