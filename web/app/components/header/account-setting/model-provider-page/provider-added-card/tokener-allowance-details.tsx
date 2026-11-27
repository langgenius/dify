import type { ModelProviderCreditsResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import {
  formatTokenerCredits,
  formatUsdMicro,
  formatUtcAllowancePeriod,
} from './tokener-amount-format'

type TokenerMetering = NonNullable<ModelProviderCreditsResponse['tokener_metering']>

type TokenerAllowanceDetailsProps = {
  planAllowance: TokenerMetering['plan_allowance']
  purchasedAvailableUsdMicro: TokenerMetering['purchased_available_usd_micro']
}

export function TokenerAllowanceDetails({
  planAllowance,
  purchasedAvailableUsdMicro,
}: TokenerAllowanceDetailsProps) {
  const { t } = useTranslation(['modelProvider'])
  const { data: billingPlan } = useQuery(
    consoleQuery.features.get.queryOptions({
      enabled: planAllowance?.plan === 'paid',
      select: ({ billing }) => billing.subscription.plan,
    }),
  )

  if (!planAllowance && purchasedAvailableUsdMicro == null) return null

  const planName =
    planAllowance?.plan === 'sandbox'
      ? 'Sandbox'
      : billingPlan === 'professional'
        ? 'Pro'
        : billingPlan === 'team'
          ? 'Team'
          : null
  const lessThanOne = t(($) => $['modelProvider.tokenerLessThanOneCredit'])

  return (
    <details className="group mt-2 border-t border-divider-subtle pt-2">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-xs system-sm-medium text-text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-accent-solid [&::-webkit-details-marker]:hidden">
        {t(($) => $['modelProvider.tokenerBalanceDetails'])}
        <span aria-hidden className="i-ri-arrow-down-s-line size-4 group-open:rotate-180" />
      </summary>
      <dl className="mt-2 grid gap-2">
        {planAllowance && (
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <dt className="system-sm-regular text-text-tertiary">
              {planName
                ? t(($) => $['modelProvider.tokenerPlanCredits'], { plan: planName })
                : t(($) => $['modelProvider.tokenerCurrentPlanCredits'])}
            </dt>
            <dd className="system-sm-semibold text-text-secondary tabular-nums">
              {t(($) => $['modelProvider.tokenerCreditsRemaining'], {
                remaining: formatTokenerCredits(planAllowance.available_usd_micro, lessThanOne),
                total: formatTokenerCredits(planAllowance.amount_usd_micro, lessThanOne),
              })}
            </dd>
            {planAllowance.ends_at && (
              <dd className="basis-full system-xs-regular text-text-tertiary">
                {t(($) => $['modelProvider.tokenerAllowancePeriod'], {
                  period: formatUtcAllowancePeriod(planAllowance.starts_at, planAllowance.ends_at),
                })}
              </dd>
            )}
          </div>
        )}
        {purchasedAvailableUsdMicro != null && (
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <dt className="system-sm-regular text-text-tertiary">
              {t(($) => $['modelProvider.tokenerPurchasedBalance'])}
            </dt>
            <dd className="system-sm-semibold text-text-secondary tabular-nums">
              <bdi>{formatUsdMicro(purchasedAvailableUsdMicro).replace('$', 'USD ')}</bdi>
            </dd>
          </div>
        )}
      </dl>
    </details>
  )
}
