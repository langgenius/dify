import type { GetBillingSubscriptionData } from '@dify/contracts/api/console/billing/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { Switch } from '@langgenius/dify-ui/switch'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { consoleQuery } from '@/service/client'
import Cloud from './assets/cloud'
import NoiseBottom from './assets/noise-bottom'
import NoiseTop from './assets/noise-top'
import SelfHosted from './assets/self-hosted'
import { PricingFooter } from './footer'
import Header from './header'
import { CloudPlanItem } from './plans/cloud-plan-item'
import { SelfHostedPlanItem } from './plans/self-hosted-plan-item'

type BillingInterval = GetBillingSubscriptionData['query']['interval']

export function PricingContent({ pricingPageURL }: { pricingPageURL: string }) {
  const { t } = useTranslation()
  const { data: features } = useQuery(consoleQuery.features.get.queryOptions())
  const educationEnabled = features?.education.enabled ?? false
  const { data: isEducationAccount = false } = useQuery(
    consoleQuery.account.education.get.queryOptions({
      enabled: educationEnabled,
      select: ({ is_student }) => is_student ?? false,
    }),
  )
  const canManageBilling = useAtomValue(isCurrentWorkspaceManagerAtom)
  const isEducationDiscountEligible = educationEnabled && isEducationAccount
  const defaultBillingInterval: BillingInterval =
    canManageBilling && isEducationDiscountEligible ? 'year' : 'month'
  const [activeCategory, setActiveCategory] = React.useState<'cloud' | 'self-hosted'>('cloud')
  const [selectedBillingInterval, setSelectedBillingInterval] = React.useState<BillingInterval>()
  const billingInterval = selectedBillingInterval ?? defaultBillingInterval
  const isCloud = activeCategory === 'cloud'
  const currentCloudPlan = features?.billing.subscription.plan ?? 'sandbox'

  return (
    <Tabs
      defaultValue="cloud"
      onValueChange={setActiveCategory}
      className="relative grid min-h-full grid-rows-[1fr_auto_auto_1fr] overflow-hidden"
    >
      <div className="absolute inset-x-0 -top-12 -z-10">
        <NoiseTop />
      </div>

      <Header />

      <div className="flex w-full justify-center border-t border-divider-accent px-10">
        <div className="flex max-w-[1680px] grow items-center justify-between border-x border-divider-accent p-1">
          <TabsList
            activateOnFocus
            aria-label={t(($) => $['plansCommon.title.plans'], { ns: 'billing' })}
            className="items-center gap-0"
          >
            <TabsTab
              value="cloud"
              className="appearance-none justify-center gap-x-2 border-b-0 px-5 py-3 outline-hidden data-active:border-transparent"
              render={(props, { active }) => (
                <button {...props}>
                  <Cloud isActive={active} />
                  <span
                    className={cn(
                      'system-xl-semibold text-text-secondary',
                      active && 'text-saas-dify-blue-accessible',
                    )}
                  >
                    {t(($) => $['plansCommon.cloud'], { ns: 'billing' })}
                  </span>
                </button>
              )}
            />
            <Divider type="vertical" className="mx-2 h-4 bg-divider-accent" />
            <TabsTab
              value="self-hosted"
              className="appearance-none justify-center gap-x-2 border-b-0 px-5 py-3 outline-hidden data-active:border-transparent"
              render={(props, { active }) => (
                <button {...props}>
                  <SelfHosted isActive={active} />
                  <span
                    className={cn(
                      'system-xl-semibold text-text-secondary',
                      active && 'text-saas-dify-blue-accessible',
                    )}
                  >
                    {t(($) => $['plansCommon.self'], { ns: 'billing' })}
                  </span>
                </button>
              )}
            />
          </TabsList>
          {isCloud && (
            <div className="flex items-center justify-end gap-x-3 pr-5">
              <Switch
                aria-label={t(($) => $['plansCommon.yearlyBilling'], { ns: 'billing' })}
                size="lg"
                checked={billingInterval === 'year'}
                onCheckedChange={(checked) =>
                  setSelectedBillingInterval(checked ? 'year' : 'month')
                }
              />
              <span className="system-md-regular text-text-tertiary">
                {t(($) => $['plansCommon.annualBilling'], { ns: 'billing', percent: 17 })}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="flex w-full justify-center border-t border-divider-accent px-10">
        <TabsPanel
          value="cloud"
          className="flex max-w-[1680px] grow border-x border-divider-accent"
        >
          <CloudPlanItem
            currentPlan={currentCloudPlan}
            plan="sandbox"
            billingInterval={billingInterval}
            isEducationDiscountEligible={isEducationDiscountEligible}
          />
          <Divider type="vertical" className="mx-0 shrink-0 bg-divider-accent" />
          <CloudPlanItem
            currentPlan={currentCloudPlan}
            plan="professional"
            billingInterval={billingInterval}
            isEducationDiscountEligible={isEducationDiscountEligible}
          />
          <Divider type="vertical" className="mx-0 shrink-0 bg-divider-accent" />
          <CloudPlanItem
            currentPlan={currentCloudPlan}
            plan="team"
            billingInterval={billingInterval}
            isEducationDiscountEligible={isEducationDiscountEligible}
          />
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

      <PricingFooter pricingPageURL={pricingPageURL} category={activeCategory} />

      <div className="absolute inset-x-0 -bottom-12 -z-10">
        <NoiseBottom />
      </div>
    </Tabs>
  )
}
