import type { GetBillingSubscriptionData } from '@dify/contracts/api/console/billing/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Switch } from '@langgenius/dify-ui/switch'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { consoleQuery } from '@/service/console'
import Cloud from './assets/cloud'
import NoiseBottom from './assets/noise-bottom'
import NoiseTop from './assets/noise-top'
import SelfHosted from './assets/self-hosted'
import { PricingFooter } from './footer'
import Header from './header'

const CloudPlanItem = React.lazy(() =>
  import('./plans/cloud-plan-item').then((module) => ({ default: module.CloudPlanItem })),
)
const SelfHostedPlanItem = React.lazy(() =>
  import('./plans/self-hosted-plan-item').then((module) => ({
    default: module.SelfHostedPlanItem,
  })),
)

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
  const isEducationDiscountEligible = educationEnabled && educationQuery.data === true
  const isPricingReady =
    features !== undefined && (!educationEnabled || educationQuery.data !== undefined)
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
  const plansSkeleton = (
    <div role="status" className="flex w-full">
      <span className="sr-only">{t(($) => $.loading, { ns: 'appApi' })}</span>
      {[0, 1, 2].map((column) => (
        <div
          key={column}
          aria-hidden="true"
          className="min-w-0 flex-1 border-divider-accent pb-3 not-first:border-l"
        >
          <div className="px-5 py-4">
            <div className="flex flex-col gap-y-6 px-1 pt-10">
              <SkeletonRectangle className="my-0 h-15.25 w-15" />
              <div className="flex min-h-26 flex-col gap-y-2">
                <SkeletonRectangle className="my-0 h-9 w-2/3" />
                <SkeletonRectangle className="my-0 h-9 w-full" />
              </div>
            </div>
            <div className="px-1 pt-4 pb-8">
              <SkeletonRectangle className="my-0 h-8 w-1/2" />
            </div>
            <SkeletonRectangle className="my-0 h-12 w-full" />
          </div>
          <div className="flex flex-col gap-y-2.5 p-6">
            {isCloud
              ? Object.entries({
                  workspace: 4,
                  knowledge: 4,
                  workflow: 3,
                  limits: 3,
                  models: 1,
                }).map(([group, rows]) => (
                  <React.Fragment key={group}>
                    {group !== 'workspace' && <Divider bgStyle="gradient" />}
                    {Array.from({ length: rows }, (_, row) => (
                      <SkeletonRectangle key={row} className="my-0 h-4.5 w-4/5" />
                    ))}
                  </React.Fragment>
                ))
              : Array.from({ length: 9 }, (_, row) => (
                  <SkeletonRectangle
                    key={row}
                    className={cn('my-0 h-4.5 w-4/5', row === 0 && 'h-8')}
                  />
                ))}
          </div>
        </div>
      ))}
    </div>
  )

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
                disabled={!isPricingReady}
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
          <React.Suspense fallback={plansSkeleton}>
            {isPricingReady && currentCloudPlan ? (
              <>
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
              </>
            ) : pricingError ? (
              <div
                role="alert"
                className="flex min-h-96 w-full flex-col items-center justify-center gap-4"
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
              plansSkeleton
            )}
          </React.Suspense>
        </TabsPanel>
        <TabsPanel
          value="self-hosted"
          className="flex max-w-[1680px] grow border-x border-divider-accent"
        >
          <React.Suspense fallback={plansSkeleton}>
            <SelfHostedPlanItem plan="community" />
            <Divider type="vertical" className="mx-0 shrink-0 bg-divider-accent" />
            <SelfHostedPlanItem plan="premium" />
            <Divider type="vertical" className="mx-0 shrink-0 bg-divider-accent" />
            <SelfHostedPlanItem plan="enterprise" />
          </React.Suspense>
        </TabsPanel>
      </div>

      <PricingFooter category={activeCategory} />

      <div className="absolute inset-x-0 -bottom-12 -z-10">
        <NoiseBottom />
      </div>
    </Tabs>
  )
}
