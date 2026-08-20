import type { GetBillingSubscriptionData } from '@dify/contracts/api/console/billing/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Switch } from '@langgenius/dify-ui/switch'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { consoleQuery } from '@/service/console'
import Cloud from './assets/cloud'
import NoiseBottom from './assets/noise-bottom'
import NoiseTop from './assets/noise-top'
import SelfHosted from './assets/self-hosted'
import { PricingFooter } from './footer'
import Header from './header'
import { CloudPlanItem } from './plans/cloud-plan-item'
import { SelfHostedPlanItem } from './plans/self-hosted-plan-item'

type BillingInterval = GetBillingSubscriptionData['query']['interval']

export function PricingContent() {
  const { t } = useTranslation()
  const featuresQuery = useQuery(consoleQuery.features.get.queryOptions())
  const { data: features } = featuresQuery
  const educationEnabled = features?.education.enabled ?? false
  const educationQuery = useQuery(
    consoleQuery.account.education.get.queryOptions({
      enabled: educationEnabled,
      select: ({ is_student }) => is_student ?? false,
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
  const [activeCategory, setActiveCategory] = React.useState<'cloud' | 'self-hosted'>('cloud')
  const [selectedBillingInterval, setSelectedBillingInterval] = React.useState<BillingInterval>()
  const billingInterval = selectedBillingInterval ?? defaultBillingInterval
  const isCloud = activeCategory === 'cloud'
  const currentCloudPlan = features?.billing.subscription.plan
  const billing = currentCloudPlan
    ? {
        currentPlan: currentCloudPlan,
        isEducationDiscountEligible,
      }
    : undefined

  return (
    <Tabs
      value={activeCategory}
      onValueChange={setActiveCategory}
      className="relative grid min-h-full grid-rows-[1fr_auto_auto_1fr] overflow-clip"
    >
      <div className="absolute inset-x-0 -top-12 -z-10">
        <NoiseTop />
      </div>

      <Header />

      <div className="flex w-full justify-center border-t border-divider-accent px-10">
        <div className="flex max-w-[1680px] grow items-center justify-between border-x border-divider-accent p-1">
          <TabsList
            aria-label={t(($) => $['plansCommon.title.plans'], { ns: 'billing' })}
            className="items-center gap-0"
          >
            <TabsTab
              value="cloud"
              className="appearance-none justify-center gap-x-2 border-b-0 px-5 py-3 system-xl-semibold text-text-secondary hover:text-saas-dify-blue-accessible data-active:border-transparent data-active:text-saas-dify-blue-accessible"
            >
              <Cloud />
              {t(($) => $['plansCommon.cloud'], { ns: 'billing' })}
            </TabsTab>
            <Divider type="vertical" className="mx-2 h-4 bg-divider-accent" />
            <TabsTab
              value="self-hosted"
              className="appearance-none justify-center gap-x-2 border-b-0 px-5 py-3 system-xl-semibold text-text-secondary hover:text-saas-dify-blue-accessible data-active:border-transparent data-active:text-saas-dify-blue-accessible"
            >
              <SelfHosted />
              {t(($) => $['plansCommon.self'], { ns: 'billing' })}
            </TabsTab>
          </TabsList>
          {isCloud && (
            <Field>
              <FieldLabel className="flex items-center justify-end gap-x-3 pr-5">
                <Switch
                  size="lg"
                  checked={billingInterval === 'year'}
                  onCheckedChange={(checked) =>
                    setSelectedBillingInterval(checked ? 'year' : 'month')
                  }
                />
                <span className="system-md-regular text-text-tertiary">
                  {t(($) => $['plansCommon.annualBilling'], { ns: 'billing', percent: 17 })}
                </span>
              </FieldLabel>
            </Field>
          )}
        </div>
      </div>

      <div className="flex w-full justify-center border-t border-divider-accent px-10">
        <TabsPanel
          value="cloud"
          className="flex max-w-[1680px] grow flex-wrap border-x border-divider-accent"
        >
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
          <CloudPlanItem plan="sandbox" billingInterval={billingInterval} billing={billing} />
          <Divider type="vertical" className="mx-0 shrink-0 bg-divider-accent" />
          <CloudPlanItem plan="professional" billingInterval={billingInterval} billing={billing} />
          <Divider type="vertical" className="mx-0 shrink-0 bg-divider-accent" />
          <CloudPlanItem plan="team" billingInterval={billingInterval} billing={billing} />
        </TabsPanel>
        <TabsPanel
          value="self-hosted"
          className="flex max-w-[1680px] grow border-x border-divider-accent"
        >
          <SelfHostedPlanItem plan="community" />
          <Divider type="vertical" className="mx-0 shrink-0 bg-divider-accent" />
          <SelfHostedPlanItem plan="premium" />
          <Divider type="vertical" className="mx-0 shrink-0 bg-divider-accent" />
          <SelfHostedPlanItem plan="enterprise" />
        </TabsPanel>
      </div>

      <PricingFooter category={activeCategory} />

      <div className="absolute inset-x-0 -bottom-12 -z-10">
        <NoiseBottom />
      </div>
    </Tabs>
  )
}
