'use client'

import type { AccessControlChipKind } from './chip-status'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { useTranslation } from 'react-i18next'
import PremiumBadge from '@/app/components/base/premium-badge'

type AccessControlChipAffixProps = {
  kind: AccessControlChipKind
  coveredCount: number
  inServiceCount: number
}

export function AccessControlChipAffix({
  kind,
  coveredCount,
  inServiceCount,
}: AccessControlChipAffixProps) {
  const { t } = useTranslation()

  if (kind === 'pro') {
    return (
      <PremiumBadge size="s" color="blue">
        <span
          aria-hidden
          className="i-custom-public-common-sparkles-soft flex h-3.5 w-3.5 items-center py-px pl-0.75 text-components-premium-badge-indigo-text-stop-0"
        />
        <span className="system-xs-medium">
          {t(($) => $['studio.accessControl.proBadge'], { ns: 'deployments' })}
        </span>
      </PremiumBadge>
    )
  }

  const statusLabel =
    kind === 'on'
      ? t(($) => $['studio.accessControl.chipOn'], { ns: 'deployments' })
      : kind === 'partial'
        ? t(($) => $['studio.accessControl.chipPartial'], {
            ns: 'deployments',
            n: coveredCount,
            m: inServiceCount,
          })
        : t(($) => $['studio.accessControl.chipOff'], { ns: 'deployments' })

  return (
    <>
      <span aria-hidden className="h-3.5 w-px bg-divider-regular" />
      <span className="flex items-center gap-1">
        <span className="flex size-3 items-center justify-center">
          <StatusDot
            size="medium"
            status={kind === 'off' ? 'disabled' : kind === 'paused' ? 'warning' : 'success'}
          />
        </span>
        <span className="system-xs-semibold text-text-tertiary uppercase">{statusLabel}</span>
      </span>
    </>
  )
}
