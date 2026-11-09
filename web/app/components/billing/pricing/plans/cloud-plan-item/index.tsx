'use client'
import type { GetBillingSubscriptionData } from '@dify/contracts/api/console/billing/types.gen'
import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import { Button } from '@langgenius/dify-ui/button'
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
import styles from '../../pricing.module.css'
import { CloudPlanFeatures } from './list'

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
  const isMostPopularPlan = plan === 'professional'
  const planInfo = ALL_PLANS[plan]
  const isCurrent = plan === currentPlan
  const isCurrentPaidPlan = isCurrent && !isFreePlan
  const isCurrentSubscription =
    isCurrentPaidPlan && billingInterval === billing?.currentBillingInterval
  const isPlanDisabled =
    !billing ||
    (!isCurrentSubscription && billing.isEducationDiscountEligible === undefined) ||
    (!isCurrentPaidPlan && planInfo.level <= ALL_PLANS[billing.currentPlan].level)
  const isEducationDiscountSupportedPlan = plan === 'professional' && isYearly
  const educationDiscountWarningText =
    canManageBilling &&
    isEducationDiscountEligible &&
    !isFreePlan &&
    !isEducationDiscountSupportedPlan
      ? t(($) => $.planNotSupportEducationDiscount, { ns: 'education' })
      : undefined
  const openAsyncWindow = useAsyncWindowOpen()
  const { handleEducationDiscount, isEducationDiscountLoading } = useEducationDiscount()
  const [showEducationPricingConfirm, setShowEducationPricingConfirm] = React.useState(false)

  const buttonLabel = {
    sandbox: t(($) => $['plansCommon.startForFree'], { ns: 'billing' }),
    professional: t(($) => $['plansCommon.startBuilding'], { ns: 'billing' }),
    team: t(($) => $['plansCommon.getStarted'], { ns: 'billing' }),
  }[plan]

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

      if (isEducationDiscountEligible && isEducationDiscountSupportedPlan) {
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
    if (educationDiscountWarningText && !billing?.isEducationDiscountActivated && !isPlanDisabled) {
      setShowEducationPricingConfirm(true)
      return
    }

    await runPlanAction()
  }
  const handleUseEducationDiscount = async () => {
    await handleEducationDiscount()
  }
  const handleContinueWithoutEducationDiscount = async () => {
    await runPlanAction()
    setShowEducationPricingConfirm(false)
  }
  return (
    <div className={styles.card} data-plan={plan}>
      <div className={styles.cardHeader}>
        <div className={styles.planHeading}>
          <div className={styles.planHeading}>
            <div className={styles.planNameRow}>
              <h3 className={styles.planName}>
                {t(($) => $[`${i18nPrefix}.name`], { ns: 'billing' })}
              </h3>
              {isMostPopularPlan && (
                <div className={styles.badge}>
                  <span>{t(($) => $['plansCommon.mostPopular'], { ns: 'billing' })}</span>
                </div>
              )}
            </div>
            <div className={styles.planDescription}>
              {t(($) => $[`${i18nPrefix}.description`], { ns: 'billing' })}
            </div>
          </div>
        </div>
        {/* Price */}
        <div className={styles.price}>
          {isFreePlan && (
            <span className={styles.priceAmount}>
              {t(($) => $['plansCommon.free'], { ns: 'billing' })}
            </span>
          )}
          {!isFreePlan && (
            <>
              {isYearly && (
                <span className={styles.originalPrice}>
                  <span className="sr-only">
                    {t(($) => $['plansCommon.originalAnnualPrice'], { ns: 'billing' })}
                  </span>
                  {`$${planInfo.price * 12}`}
                </span>
              )}
              <span className={styles.priceAmount}>
                {isYearly && (
                  <span className="sr-only">
                    {t(($) => $['plansCommon.discountedAnnualPrice'], { ns: 'billing' })}
                  </span>
                )}
                {`$${isYearly ? planInfo.price * 10 : planInfo.price}`}
              </span>
              <span className={styles.priceSuffix}>
                {t(($) => $['plansCommon.priceTip'], { ns: 'billing' })}
                {t(($) => $[`plansCommon.${isYearly ? 'year' : 'month'}`], { ns: 'billing' })}
              </span>
            </>
          )}
        </div>
        <div className="relative">
          <Button
            data-plan={plan}
            variant="tertiary"
            size={null}
            disabled={isPlanDisabled}
            className={styles.planButton}
            onClick={handlePlanButtonClick}
          >
            <span className="min-w-0">{buttonLabel}</span>
          </Button>
          {educationDiscountWarningText && (
            <div className="absolute inset-x-0 top-full mt-1.5 text-start system-2xs-medium text-text-tertiary">
              {educationDiscountWarningText}
            </div>
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
          <DialogFooter>
            <Button
              size="large"
              onClick={handleContinueWithoutEducationDiscount}
              disabled={isEducationDiscountLoading}
              loading={isPlanActionPending}
              className="min-w-38"
            >
              {t(($) => $['educationPricingConfirm.cancel'], { ns: 'education' })}
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={handleUseEducationDiscount}
              loading={isEducationDiscountLoading}
              className="min-w-61"
            >
              {t(($) => $['educationPricingConfirm.continue'], { ns: 'education' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
