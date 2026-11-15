import type { GetBillingSubscriptionData } from '@dify/contracts/api/console/billing/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio-group'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { motion, useReducedMotion } from 'motion/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { consoleQuery } from '@/service/console'
import { PricingFooter } from './footer'
import Header from './header'
import { CloudPlanCard } from './plan-card'
import { PlanFeatureInfotip } from './plan-card/features'
import styles from './pricing.module.css'

type BillingInterval = GetBillingSubscriptionData['query']['interval']

const intervalOptionClassName =
  'group/interval relative flex min-w-0 flex-1 cursor-pointer flex-wrap items-center justify-center gap-1 rounded-full px-3 py-1 text-lg leading-6 font-medium text-(--pricing-subdued) outline-state-accent-solid focus-visible:outline-2 focus-visible:outline-offset-2 forced-colors:data-checked:underline data-checked:text-(--pricing-ink) sm:min-w-[190px] sm:flex-none sm:px-6 sm:text-2xl sm:leading-[30px]'

export function PricingContent() {
  const { t } = useTranslation(['appApi', 'billing', 'common'])
  const featuresQuery = useQuery(consoleQuery.features.get.queryOptions())
  const { data: features } = featuresQuery
  const canManageBilling = useAtomValue(isCurrentWorkspaceManagerAtom)
  const currentCloudPlan = features?.billing.subscription.plan
  const checkEducationEligibility =
    canManageBilling &&
    currentCloudPlan === 'sandbox' &&
    features?.education.enabled === true &&
    !features.education.activated
  const educationQuery = useQuery(
    consoleQuery.account.education.get.queryOptions({
      enabled: checkEducationEligibility,
      select: ({ can_redeem_discount }) => can_redeem_discount,
    }),
  )
  const isEducationDiscountEligible = checkEducationEligibility ? educationQuery.data : false
  const isCheckoutReady = features !== undefined && isEducationDiscountEligible !== undefined
  const pricingError =
    (!features && featuresQuery.isError) ||
    (checkEducationEligibility && educationQuery.data === undefined && educationQuery.isError)
  const paidInterval =
    currentCloudPlan !== 'sandbox' ? features?.billing.subscription.interval : undefined
  const defaultBillingInterval: BillingInterval =
    paidInterval === 'year' || paidInterval === 'month'
      ? paidInterval
      : canManageBilling && isEducationDiscountEligible
        ? 'year'
        : 'month'
  const [selectedBillingInterval, setSelectedBillingInterval] = React.useState<BillingInterval>()
  const billingInterval = selectedBillingInterval ?? defaultBillingInterval
  const indicatorId = React.useId()
  const reducedMotion = useReducedMotion()
  const intervalIndicator = (
    <motion.span
      aria-hidden="true"
      initial={false}
      layoutId={reducedMotion ? undefined : indicatorId}
      transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
      className="pointer-events-none absolute inset-0 -z-1 rounded-full bg-components-button-secondary-bg group-focus-visible/interval:transform-none! group-focus-visible/interval:opacity-100! motion-reduce:transform-none! motion-reduce:opacity-100!"
    />
  )
  const billing = currentCloudPlan
    ? {
        currentPlan: currentCloudPlan,
        currentBillingInterval: features.billing.subscription.interval,
        isEducationDiscountEligible,
      }
    : undefined

  return (
    <div
      className={`${styles.content} relative isolate min-h-full bg-background-default px-4 py-6 text-(--pricing-ink) sm:px-6 xl:px-13 xl:pt-10`}
    >
      <Header />
      <RadioGroup
        aria-label={t(($) => $['pricing.billingInterval'], { ns: 'billing' })}
        value={billingInterval}
        onValueChange={setSelectedBillingInterval}
        className="relative isolate mx-auto my-8 min-h-[49px] w-full max-w-full gap-0 rounded-full border border-(--pricing-switch-border) bg-(--pricing-switch) p-1 sm:w-fit"
      >
        <RadioItem value="month" className={intervalOptionClassName}>
          {billingInterval === 'month' && intervalIndicator}
          {t(($) => $['pricing.monthly'], { ns: 'billing' })}
        </RadioItem>
        <RadioItem value="year" className={intervalOptionClassName}>
          {billingInterval === 'year' && intervalIndicator}
          {t(($) => $['pricing.annually'], { ns: 'billing' })}
          <span className="font-[PricingInter,sans-serif] text-sm leading-[inherit] font-semibold text-text-accent sm:text-xl sm:leading-[inherit]">
            {t(($) => $['pricing.savings'], { ns: 'billing', percent: 17 })}
          </span>
        </RadioItem>
      </RadioGroup>
      <div>
        {pricingError ? (
          <div
            role="alert"
            className="flex w-full items-center justify-center gap-3 border-b border-divider-accent p-3"
          >
            <p>{t(($) => $.error, { ns: 'common' })}</p>
            <Button
              onClick={() => {
                if (!features) void featuresQuery.refetch()
                else void educationQuery.refetch()
              }}
            >
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </Button>
          </div>
        ) : (
          !isCheckoutReady && (
            <span role="status" className="sr-only">
              {t(($) => $.loading, { ns: 'appApi' })}
            </span>
          )
        )}
        <PlanFeatureInfotip>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <CloudPlanCard plan="sandbox" billingInterval={billingInterval} billing={billing} />
            <CloudPlanCard
              plan="professional"
              billingInterval={billingInterval}
              billing={billing}
            />
            <CloudPlanCard plan="team" billingInterval={billingInterval} billing={billing} />
          </div>
        </PlanFeatureInfotip>
      </div>
      <PricingFooter />
    </div>
  )
}
