'use client'
import type { GetBillingSubscriptionData } from '@dify/contracts/api/console/billing/types.gen'
import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { useAsyncWindowOpen } from '@/hooks/use-async-window-open'
import { consoleClient } from '@/service/console'
import { billingErrorMessageKey } from '../../billing-error'
import { ALL_PLANS } from '../../config'
import { useEducationDiscount } from '../../hooks/use-education-discount'
import { CloudPlanFeatures } from './features'
import { RollingPrice } from './rolling-price'

type CloudPlanCardProps = {
  plan: CloudPlan
  billingInterval: GetBillingSubscriptionData['query']['interval']
  billing:
    | {
        currentPlan: CloudPlan
        currentBillingInterval: string
        isEducationDiscountEligible: boolean | undefined
      }
    | undefined
}

export function CloudPlanCard({ plan, billingInterval, billing }: CloudPlanCardProps) {
  const currentPlan = billing?.currentPlan
  const isEducationDiscountEligible = billing?.isEducationDiscountEligible
  const { t } = useTranslation(['billing', 'common', 'education'])
  const canManageBilling = useAtomValue(isCurrentWorkspaceManagerAtom)
  const [isPlanActionPending, setIsPlanActionPending] = React.useState(false)
  const isYearly = billingInterval === 'year'
  const i18nPrefix = `plans.${plan}` as const
  const isFreePlan = plan === 'sandbox'
  const isPrimaryAction =
    (currentPlan === 'sandbox' && plan === 'professional') ||
    ((currentPlan === 'professional' || currentPlan === 'team') && plan === 'team')
  const planInfo = ALL_PLANS[plan]
  const isCurrent = plan === currentPlan
  const isCurrentPaidPlan = isCurrent && !isFreePlan
  const isCurrentSubscription =
    isCurrentPaidPlan && billingInterval === billing?.currentBillingInterval
  const isPlanDisabled =
    !billing ||
    (!isCurrentPaidPlan && billing.isEducationDiscountEligible === undefined) ||
    (!isCurrentPaidPlan && planInfo.level <= ALL_PLANS[billing.currentPlan].level)
  const isEducationDiscountSupportedPlan = plan === 'professional' && isYearly
  const educationOffer = isEducationDiscountEligible && isEducationDiscountSupportedPlan
  const needsEducationNotice =
    isEducationDiscountEligible && !isFreePlan && !isEducationDiscountSupportedPlan
  const needsCycleNotice =
    canManageBilling &&
    isCurrentPaidPlan &&
    (billing?.currentBillingInterval === 'month' || billing?.currentBillingInterval === 'year') &&
    !isCurrentSubscription
  const badge = isCurrentSubscription
    ? t(($) => $['plansCommon.currentPlan'], { ns: 'billing' })
    : currentPlan === 'sandbox' && plan === 'professional'
      ? t(($) => $['plansCommon.mostPopular'], { ns: 'billing' })
      : undefined
  const planName = t(($) => $[`${i18nPrefix}.name`], { ns: 'billing' })
  const cycleName = (yearly: boolean) =>
    t(($) => $[yearly ? 'pricing.cycle.annual' : 'pricing.cycle.monthly'], { ns: 'billing' })
  const openAsyncWindow = useAsyncWindowOpen()
  const { handleEducationDiscount, isEducationDiscountLoading } = useEducationDiscount()
  const [confirmationOpen, setConfirmationOpen] = React.useState(false)

  const showPlanButton =
    !canManageBilling ||
    (!isFreePlan &&
      (!billing || isCurrentPaidPlan || planInfo.level > ALL_PLANS[billing.currentPlan].level))
  const buttonLabel = !canManageBilling
    ? {
        sandbox: t(($) => $['plansCommon.startForFree'], { ns: 'billing' }),
        professional: t(($) => $['plansCommon.startBuilding'], { ns: 'billing' }),
        team: t(($) => $['plansCommon.getStarted'], { ns: 'billing' }),
      }[plan]
    : educationOffer
      ? t(($) => $.useEducationDiscount, { ns: 'education' })
      : isCurrentPaidPlan
        ? t(($) => $['plansCommon.manageSubscription'], { ns: 'billing' })
        : plan === 'team'
          ? t(($) => $['plansCommon.upgradeToTeam'], { ns: 'billing' })
          : t(($) => $['plansCommon.upgradeToProfessional'], { ns: 'billing' })

  const runPlanAction = async () => {
    if (isPlanActionPending || isEducationDiscountLoading) return

    if (!billing || isPlanDisabled) return

    setIsPlanActionPending(true)
    try {
      if (!canManageBilling) {
        toast.error(t(($) => $.buyPermissionDeniedTip, { ns: 'billing' }))
        return
      }
      if (isCurrentPaidPlan) {
        await openAsyncWindow(
          async () => {
            const { url } = await consoleClient.billing.invoices.get(undefined, {
              context: { silent: true },
            })
            if (url) return url
            throw new Error('Failed to open billing page')
          },
          {
            onError: (error) => {
              toast.error(t(($) => $[billingErrorMessageKey(error)], { ns: 'billing' }))
            },
          },
        )
        return
      }

      if (isFreePlan) return

      if (educationOffer) {
        await handleEducationDiscount()
        return
      }

      const { url } = await consoleClient.billing.subscription.get(
        { query: { plan, interval: billingInterval } },
        { context: { silent: true } },
      )
      // Adb Block additional tracking block the gtag, so we need to redirect directly
      window.location.href = url
    } catch (error) {
      toast.error(t(($) => $[billingErrorMessageKey(error)], { ns: 'billing' }))
    } finally {
      setIsPlanActionPending(false)
    }
  }
  const confirmPlanAction = async () => {
    await runPlanAction()
    setConfirmationOpen(false)
  }
  const planButton = (
    <Button
      data-plan={plan}
      variant={null}
      size={null}
      disabled={isPlanDisabled}
      loading={!confirmationOpen && (isPlanActionPending || isEducationDiscountLoading)}
      className={cn(
        'h-auto min-h-15 w-full gap-1.5 rounded-lg border p-3 text-2xl leading-[30px] font-medium whitespace-normal shadow-none disabled:cursor-default',
        isPrimaryAction
          ? 'border-saas-dify-blue-static bg-saas-dify-blue-static text-white not-data-disabled:hover:bg-saas-dify-blue-static-hover'
          : canManageBilling
            ? 'border-text-accent bg-transparent text-text-accent not-data-disabled:hover:bg-state-accent-hover-alt'
            : 'border-(--pricing-button-border) bg-(--pricing-button-bg) text-(--pricing-muted) not-data-disabled:hover:bg-components-button-secondary-bg-hover',
        isPlanDisabled &&
          'data-disabled:bg-components-button-tertiary-bg-disabled data-disabled:text-components-button-tertiary-text-disabled',
      )}
      onClick={needsEducationNotice || needsCycleNotice ? undefined : runPlanAction}
    >
      <span className="min-w-0">{buttonLabel}</span>
    </Button>
  )
  return (
    <Dialog open={confirmationOpen} onOpenChange={setConfirmationOpen}>
      <div
        className="min-w-0 rounded-2xl border border-(--pricing-card-border) bg-background-default px-6 py-8 xl:min-h-[750px] xl:px-[23px] xl:pt-10 xl:pb-11"
        data-plan={plan}
      >
        <div className="flex flex-col gap-[27px]">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-3xl leading-10 font-medium tracking-[-0.864px] sm:text-4xl sm:leading-10">
                {planName}
              </h3>
              {badge && (
                <span className="flex h-[26px] items-center rounded-sm bg-state-accent-hover-alt px-2 text-xs leading-[15px] font-semibold text-text-accent uppercase dark:bg-state-accent-hover-alt/85">
                  {badge}
                </span>
              )}
            </div>
            <div className="relative top-px min-h-[34px] text-sm leading-[17px] text-(--pricing-muted)">
              {t(($) => $[`${i18nPrefix}.description`], { ns: 'billing' })}
            </div>
          </div>
          <div className="relative -top-[3px] flex min-h-[30px] flex-wrap items-baseline gap-1.5">
            {isFreePlan && (
              <span className="text-2xl leading-[30px] font-medium">
                {t(($) => $['plansCommon.free'], { ns: 'billing' })}
              </span>
            )}
            {!isFreePlan && (
              <>
                <span
                  className={cn(
                    'text-2xl leading-[30px] font-medium',
                    plan === 'professional' && 'text-text-primary',
                  )}
                >
                  <RollingPrice
                    monthly={planInfo.price}
                    annual={planInfo.price * 10}
                    isYearly={isYearly}
                  />
                </span>
                <span className="text-xl leading-[25px]">
                  {t(($) => $['plansCommon.priceTip'], { ns: 'billing' })}
                  {t(($) => $[`plansCommon.${isYearly ? 'year' : 'month'}`], { ns: 'billing' })}
                </span>
              </>
            )}
          </div>
          <div className="relative min-h-15">
            {showPlanButton && (
              <>
                {needsEducationNotice || needsCycleNotice ? (
                  <DialogTrigger render={planButton} />
                ) : (
                  planButton
                )}
                {needsEducationNotice && (
                  <div className="mt-1.5 text-start system-2xs-medium text-text-tertiary">
                    {t(($) => $.planNotSupportEducationDiscount, { ns: 'education' })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        <CloudPlanFeatures plan={plan} />

        <DialogContent backdropProps={{ forceRender: true }} className="w-130">
          <DialogHeader>
            <DialogTitle>
              {needsCycleNotice
                ? t(($) => $['pricing.cycleNotice.title'], {
                    ns: 'billing',
                    plan_name: planName,
                    current_billing_cycle: cycleName(billing?.currentBillingInterval === 'year'),
                  })
                : t(($) => $['educationPricingConfirm.title'], { ns: 'education' })}
            </DialogTitle>
            <DialogDescription>
              {needsCycleNotice
                ? t(($) => $['pricing.cycleNotice.description'], {
                    ns: 'billing',
                    target_billing_cycle: cycleName(isYearly),
                  })
                : t(($) => $['educationPricingConfirm.description'], {
                    ns: 'education',
                    selected_plan_name: planName,
                    selected_billing_cycle: cycleName(isYearly),
                  })}
            </DialogDescription>
            <DialogHeaderCloseButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            />
          </DialogHeader>
          <DialogFooter className="max-sm:flex-col max-sm:items-stretch">
            {needsCycleNotice ? (
              <>
                <DialogClose render={<Button size="large" />}>
                  {t(($) => $['pricing.cycleNotice.back'], { ns: 'billing' })}
                </DialogClose>
                <Button
                  size="large"
                  variant="primary"
                  loading={isPlanActionPending}
                  onClick={confirmPlanAction}
                >
                  {t(($) => $['plansCommon.manageSubscription'], { ns: 'billing' })}
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="large"
                  onClick={confirmPlanAction}
                  disabled={isEducationDiscountLoading}
                  loading={isPlanActionPending}
                  className="h-auto min-h-9 w-full whitespace-normal sm:w-auto sm:min-w-38"
                >
                  {t(($) => $['educationPricingConfirm.cancel'], { ns: 'education' })}
                </Button>
                <Button
                  variant="primary"
                  size="large"
                  onClick={handleEducationDiscount}
                  disabled={isPlanActionPending}
                  loading={isEducationDiscountLoading}
                  className="h-auto min-h-9 w-full whitespace-normal sm:w-auto sm:min-w-61"
                >
                  {t(($) => $['educationPricingConfirm.continue'], { ns: 'education' })}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </div>
    </Dialog>
  )
}
