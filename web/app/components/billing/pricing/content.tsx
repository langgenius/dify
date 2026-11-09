import type { GetBillingSubscriptionData } from '@dify/contracts/api/console/billing/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio-group'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { consoleQuery } from '@/service/console'
import { PricingFooter } from './footer'
import Header from './header'
import { CloudPlanItem } from './plans/cloud-plan-item'
import styles from './pricing.module.css'

type BillingInterval = GetBillingSubscriptionData['query']['interval']

export function PricingContent() {
  const { t } = useTranslation(['appApi', 'billing', 'common'])
  const featuresQuery = useQuery(consoleQuery.features.get.queryOptions())
  const { data: features } = featuresQuery
  const educationEnabled = features?.education.enabled ?? false
  const educationQuery = useQuery(
    consoleQuery.account.education.get.queryOptions({
      enabled: educationEnabled,
      select: ({ is_student }) => is_student,
    }),
  )
  const canManageBilling = useAtomValue(isCurrentWorkspaceManagerAtom)
  const isEducationDiscountEligible = educationEnabled ? educationQuery.data : false
  const isCheckoutReady = features !== undefined && isEducationDiscountEligible !== undefined
  const pricingError =
    (!features && featuresQuery.isError) ||
    (educationEnabled && educationQuery.data === undefined && educationQuery.isError)
  const defaultBillingInterval: BillingInterval =
    canManageBilling && isEducationDiscountEligible ? 'year' : 'month'
  const [selectedBillingInterval, setSelectedBillingInterval] = React.useState<BillingInterval>()
  const billingInterval = selectedBillingInterval ?? defaultBillingInterval
  const currentCloudPlan = features?.billing.subscription.plan
  const billing = currentCloudPlan
    ? {
        currentPlan: currentCloudPlan,
        currentBillingInterval: features.billing.subscription.interval,
        isEducationDiscountEligible,
        isEducationDiscountActivated: features.education.activated,
      }
    : undefined

  return (
    <div className={styles.content}>
      <Header />
      <RadioGroup
        aria-label={t(($) => $['pricing.billingInterval'], { ns: 'billing' })}
        value={billingInterval}
        onValueChange={setSelectedBillingInterval}
        className={styles.billingInterval}
      >
        <RadioItem value="month" className={styles.intervalOption}>
          {t(($) => $['pricing.monthly'], { ns: 'billing' })}
        </RadioItem>
        <RadioItem value="year" className={styles.intervalOption}>
          {t(($) => $['pricing.annually'], { ns: 'billing' })}
          <span className={styles.savings}>
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
        <div className={styles.plans}>
          <CloudPlanItem plan="sandbox" billingInterval={billingInterval} billing={billing} />
          <CloudPlanItem plan="professional" billingInterval={billingInterval} billing={billing} />
          <CloudPlanItem plan="team" billingInterval={billingInterval} billing={billing} />
        </div>
      </div>
      <PricingFooter />
    </div>
  )
}
