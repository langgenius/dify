'use client'
import type { GetBillingSubscriptionData } from '@dify/contracts/api/console/billing/types.gen'
import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { useAsyncWindowOpen } from '@/hooks/use-async-window-open'
import { consoleClient } from '@/service/console'
import { billingErrorMessageKey } from '../../../billing-error'
import { ALL_PLANS } from '../../../config'
import { useEducationDiscount } from '../../../hooks/use-education-discount'
import { CloudPlanFeatures } from './list'
import { RollingPrice } from './rolling-price'

type CloudPlanItemProps = {
  plan: CloudPlan
  billingInterval: GetBillingSubscriptionData['query']['interval']
  billing:
    | {
        currentPlan: CloudPlan
        currentBillingInterval: string
        isEducationDiscountEligible: boolean | undefined
        isEducationDiscountActivated: boolean
      }
    | undefined
}

export function CloudPlanItem({ plan, billingInterval, billing }: CloudPlanItemProps) {
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
  const isMostPopularPlan = plan === 'professional'
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
  const educationDiscountWarningText =
    currentPlan === 'sandbox' &&
    !billing?.isEducationDiscountActivated &&
    canManageBilling &&
    isEducationDiscountEligible &&
    !isFreePlan &&
    !isEducationDiscountSupportedPlan
      ? t(($) => $.planNotSupportEducationDiscount, { ns: 'education' })
      : undefined
  const openAsyncWindow = useAsyncWindowOpen()
  const { handleEducationDiscount, isEducationDiscountLoading } = useEducationDiscount()
  const [showEducationPricingConfirm, setShowEducationPricingConfirm] = React.useState(false)

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
      if (isCurrentSubscription) {
        if (!canManageBilling) {
          toast.error(t(($) => $.buyPermissionDeniedTip, { ns: 'billing' }))
          return
        }

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

      if (!canManageBilling) {
        toast.error(t(($) => $.buyPermissionDeniedTip, { ns: 'billing' }))
        return
      }

      if (
        currentPlan === 'sandbox' &&
        !billing.isEducationDiscountActivated &&
        isEducationDiscountEligible &&
        isEducationDiscountSupportedPlan
      ) {
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
  const handlePlanButtonClick = async () => {
    if (educationDiscountWarningText && !isPlanDisabled) {
      setShowEducationPricingConfirm(true)
      return
    }

    await runPlanAction()
  }
  const handleContinueWithoutEducationDiscount = async () => {
    await runPlanAction()
    setShowEducationPricingConfirm(false)
  }
  return (
    <div
      className="min-w-0 rounded-2xl border border-(--pricing-card-border) bg-background-default px-6 py-8 xl:min-h-[750px] xl:px-[23px] xl:pt-10 xl:pb-11"
      data-plan={plan}
    >
      <div className="flex flex-col gap-[27px]">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-3xl leading-10 font-medium tracking-[-0.864px] sm:text-4xl sm:leading-10">
              {t(($) => $[`${i18nPrefix}.name`], { ns: 'billing' })}
            </h3>
            {canManageBilling && (isCurrentSubscription || (isCurrent && isFreePlan)) && (
              <span>{t(($) => $['plansCommon.currentPlan'], { ns: 'billing' })}</span>
            )}
            {isMostPopularPlan && (
              <div className="flex h-[26px] items-center rounded-sm bg-state-accent-hover-alt px-2 text-xs leading-[15px] font-semibold text-text-accent uppercase dark:bg-state-accent-hover-alt/85">
                <span>{t(($) => $['plansCommon.mostPopular'], { ns: 'billing' })}</span>
              </div>
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
                  isMostPopularPlan && 'text-text-primary',
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
              <Button
                data-plan={plan}
                variant="tertiary"
                size={null}
                disabled={isPlanDisabled}
                loading={
                  !showEducationPricingConfirm &&
                  (isPlanActionPending || isEducationDiscountLoading)
                }
                className={cn(
                  'h-auto min-h-15 w-full rounded-lg border p-3 text-2xl leading-[30px] font-medium whitespace-normal shadow-none disabled:cursor-default',
                  isPrimaryAction
                    ? 'border-saas-dify-blue-static bg-saas-dify-blue-static text-white enabled:hover:bg-saas-dify-blue-static-hover'
                    : canManageBilling
                      ? 'border-text-accent bg-transparent text-text-accent enabled:hover:bg-state-accent-hover-alt'
                      : 'border-(--pricing-button-border) bg-(--pricing-button-bg) text-(--pricing-muted) enabled:hover:bg-components-button-secondary-bg-hover',
                )}
                onClick={handlePlanButtonClick}
              >
                <span className="min-w-0">{buttonLabel}</span>
              </Button>
              {educationDiscountWarningText && (
                <div className="mt-1.5 text-start system-2xs-medium text-text-tertiary">
                  {educationDiscountWarningText}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <CloudPlanFeatures plan={plan} />
      <Dialog open={showEducationPricingConfirm} onOpenChange={setShowEducationPricingConfirm}>
        <DialogContent backdropProps={{ forceRender: true }} className="w-130">
          <DialogHeader>
            <DialogTitle>
              {t(($) => $['educationPricingConfirm.title'], { ns: 'education' })}
            </DialogTitle>
            <DialogDescription>
              {t(($) => $['educationPricingConfirm.description'], { ns: 'education' })}
            </DialogDescription>
            <DialogHeaderCloseButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            />
          </DialogHeader>
          <DialogFooter className="max-sm:flex-col max-sm:items-stretch">
            <Button
              size="large"
              onClick={handleContinueWithoutEducationDiscount}
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
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
