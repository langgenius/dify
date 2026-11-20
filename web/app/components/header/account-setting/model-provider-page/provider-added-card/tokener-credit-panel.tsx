import type { ModelProviderCreditsResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { useTranslation } from 'react-i18next'

type TokenerCreditPanelProps = {
  bootstrapStatus: ModelProviderCreditsResponse['tokener_bootstrap_status']
  metering: ModelProviderCreditsResponse['tokener_metering']
}

function formatUsdMicro(raw: string) {
  if (!/^-?\d+$/.test(raw)) return '—'
  const micro = BigInt(raw)
  const magnitude = micro < 0n ? -micro : micro
  const whole = new Intl.NumberFormat().format(magnitude / 1_000_000n)
  const fraction = (magnitude % 1_000_000n)
    .toString()
    .padStart(6, '0')
    .replace(/0+$/, '')
    .padEnd(2, '0')
  return `${micro < 0n ? '-$' : '$'}${whole}.${fraction}`
}

export function TokenerCreditPanel({ bootstrapStatus, metering }: TokenerCreditPanelProps) {
  const { t } = useTranslation(['modelProvider'])
  const label = t(($) => $['modelProvider.tokenerUsageLabel'])
  if (bootstrapStatus !== 'ready' || !metering) {
    const message =
      bootstrapStatus === 'failed'
        ? t(($) => $['modelProvider.tokenerUsageSetupFailed'])
        : bootstrapStatus && bootstrapStatus !== 'ready'
          ? t(($) => $['modelProvider.tokenerUsagePending'])
          : t(($) => $['modelProvider.tokenerUsageUnavailable'])
    return (
      <section
        aria-label={label}
        className="rounded-xl border border-components-panel-border px-4 py-3"
      >
        <div className="system-xs-medium-uppercase text-text-tertiary">{label}</div>
        <div role="status" className="mt-1 system-sm-regular text-text-secondary">
          {message}
        </div>
      </section>
    )
  }

  const usage = metering.current_month
  const entitlementStatus = metering.entitlement_status
  const pendingAllowance =
    entitlementStatus === 'processing'
      ? t(($) => $['modelProvider.tokenerEntitlementProcessing'])
      : entitlementStatus === 'retrying'
        ? t(($) => $['modelProvider.tokenerEntitlementRetrying'])
        : entitlementStatus === 'failed'
          ? t(($) => $['modelProvider.tokenerEntitlementFailed'])
          : null
  const allowance = pendingAllowance ? null : metering.allowance
  return (
    <section
      aria-label={label}
      className="rounded-xl border border-components-panel-border px-4 py-3"
    >
      <div className="system-xs-medium-uppercase text-text-tertiary">{label}</div>
      <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-2 text-text-secondary">
        <div>
          <dt className="system-xs-regular text-text-tertiary">
            {t(($) => $['modelProvider.tokenerAvailableUsd'])}
          </dt>
          <dd className="system-md-semibold">{formatUsdMicro(metering.available_usd_micro)}</dd>
        </div>
        {usage.status === 'available' && (
          <div>
            <dt className="system-xs-regular text-text-tertiary">
              {t(($) => $['modelProvider.tokenerBilledThisMonth'], { date: usage.end_date })}
            </dt>
            <dd className="system-md-semibold">{formatUsdMicro(usage.billed_usd_micro)}</dd>
          </div>
        )}
        {allowance && (
          <div>
            <dt className="system-xs-regular text-text-tertiary">
              {t(($) => $['modelProvider.tokenerAllowanceRemaining'])}
            </dt>
            <dd className="system-md-semibold">{formatUsdMicro(allowance.available_usd_micro)}</dd>
          </div>
        )}
      </dl>
      {usage.status === 'unavailable' && (
        <p role="status" className="mt-1 system-sm-regular text-text-tertiary">
          {t(($) => $['modelProvider.tokenerMonthlyUsageUnavailable'])}
        </p>
      )}
      {pendingAllowance && (
        <p role="status" className="mt-1 system-sm-regular text-text-tertiary">
          {pendingAllowance}
        </p>
      )}
    </section>
  )
}
