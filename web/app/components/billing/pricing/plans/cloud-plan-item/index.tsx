'use client'
import type { GetBillingSubscriptionData } from '@dify/contracts/api/console/billing/types.gen'
import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { toast } from '@langgenius/dify-ui/toast'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { useAsyncWindowOpen } from '@/hooks/use-async-window-open'
import { consoleClient } from '@/service/client'
import { ALL_PLANS } from '../../../config'
import { useEducationDiscount } from '../../../hooks/use-education-discount'
import Professional from '../../assets/professional'
import Sandbox from '../../assets/sandbox'
import Team from '../../assets/team'
import { CloudPlanFeatures } from './list'

const ICON_MAP = {
  sandbox: <Sandbox />,
  professional: <Professional />,
  team: <Team />,
}

type CloudPlanItemProps = {
  currentPlan: CloudPlan
  plan: CloudPlan
  billingInterval: GetBillingSubscriptionData['query']['interval']
  isEducationDiscountEligible: boolean
}

export function CloudPlanItem({
  plan,
  currentPlan,
  billingInterval,
  isEducationDiscountEligible,
}: CloudPlanItemProps) {
  const { t } = useTranslation()
  const canManageBilling = useAtomValue(isCurrentWorkspaceManagerAtom)
  const [isPlanActionPending, setIsPlanActionPending] = React.useState(false)
  const isYearly = billingInterval === 'year'
  const i18nPrefix = `plans.${plan}` as const
  const isFreePlan = plan === 'sandbox'
  const isMostPopularPlan = plan === 'professional'
  const planInfo = ALL_PLANS[plan]
  const isCurrent = plan === currentPlan
  const isCurrentPaidPlan = isCurrent && !isFreePlan
  const isPlanDisabled = isCurrentPaidPlan ? false : planInfo.level <= ALL_PLANS[currentPlan].level
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

  const buttonLabel =
    canManageBilling &&
    isEducationDiscountEligible &&
    isEducationDiscountSupportedPlan &&
    !isCurrent
      ? t(($) => $.useEducationDiscount, { ns: 'education' })
      : isCurrent
        ? t(($) => $['plansCommon.currentPlan'], { ns: 'billing' })
        : {
            sandbox: t(($) => $['plansCommon.startForFree'], { ns: 'billing' }),
            professional: t(($) => $['plansCommon.startBuilding'], { ns: 'billing' }),
            team: t(($) => $['plansCommon.getStarted'], { ns: 'billing' }),
          }[plan]

  const runPlanAction = async () => {
    if (isPlanActionPending || isEducationDiscountLoading) return

    if (isPlanDisabled) return

    setIsPlanActionPending(true)
    try {
      if (isCurrentPaidPlan) {
        if (!canManageBilling) {
          toast.error(t(($) => $.buyPermissionDeniedTip, { ns: 'billing' }))
          return
        }

        await openAsyncWindow(
          async () => {
            const { url } = await consoleClient.billing.invoices.get()
            if (url) return url
            throw new Error('Failed to open billing page')
          },
          {
            onError: (err) => {
              toast.error(err.message || String(err))
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

      const { url } = await consoleClient.billing.subscription.get({
        query: { plan, interval: billingInterval },
      })
      // Adb Block additional tracking block the gtag, so we need to redirect directly
      window.location.href = url
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
  const handleUseEducationDiscount = async () => {
    await handleEducationDiscount()
  }
  const handleContinueWithoutEducationDiscount = async () => {
    await runPlanAction()
    setShowEducationPricingConfirm(false)
  }
  return (
    <div className="flex min-w-0 flex-1 flex-col pb-3">
      <div className="flex flex-col px-5 py-4">
        <div className="flex flex-col gap-y-6 px-1 pt-10">
          {ICON_MAP[plan]}
          <div className="flex min-h-26 flex-col gap-y-2">
            <div className="flex items-center gap-x-2.5">
              <h3 className="text-[30px] leading-[1.2] font-medium text-text-primary">
                {t(($) => $[`${i18nPrefix}.name`], { ns: 'billing' })}
              </h3>
              {isMostPopularPlan && (
                <div className="flex items-center justify-center bg-saas-dify-blue-static px-1.5 py-1">
                  <span className="system-2xs-semibold-uppercase text-text-primary-on-surface">
                    {t(($) => $['plansCommon.mostPopular'], { ns: 'billing' })}
                  </span>
                </div>
              )}
            </div>
            <div className="system-sm-regular text-text-secondary">
              {t(($) => $[`${i18nPrefix}.description`], { ns: 'billing' })}
            </div>
          </div>
        </div>
        {/* Price */}
        <div className="flex items-end gap-x-2 px-1 pt-4 pb-8">
          {isFreePlan && (
            <span className="title-4xl-semi-bold text-text-primary">
              {t(($) => $['plansCommon.free'], { ns: 'billing' })}
            </span>
          )}
          {!isFreePlan && (
            <>
              {isYearly && (
                <span className="title-4xl-semi-bold text-text-quaternary line-through">
                  ${planInfo.price * 12}
                </span>
              )}
              <span className="title-4xl-semi-bold text-text-primary">
                ${isYearly ? planInfo.price * 10 : planInfo.price}
              </span>
              <span className="pb-0.5 system-md-regular text-text-tertiary">
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
            className="h-auto w-full justify-start gap-x-2 rounded-none bg-components-button-tertiary-bg py-3 pr-4 pl-5 system-xl-semibold text-text-primary hover:bg-components-button-tertiary-bg-hover data-disabled:bg-components-button-tertiary-bg-disabled data-disabled:text-text-disabled data-disabled:hover:bg-components-button-tertiary-bg-disabled data-[plan=professional]:bg-saas-dify-blue-static data-[plan=professional]:text-text-primary-on-surface data-[plan=professional]:hover:bg-saas-dify-blue-static-hover data-[plan=team]:bg-saas-background-inverted data-[plan=team]:text-background-default data-[plan=team]:hover:bg-saas-background-inverted-hover"
            onClick={handlePlanButtonClick}
          >
            <span className="grow text-start">{buttonLabel}</span>
            {!isPlanDisabled && (
              <span aria-hidden className="i-ri-arrow-right-line size-5 shrink-0" />
            )}
          </Button>
          {educationDiscountWarningText && (
            <div className="absolute inset-x-0 top-full mt-1.5 text-left system-2xs-medium text-text-tertiary">
              {educationDiscountWarningText}
            </div>
          )}
        </div>
      </div>
      <CloudPlanFeatures plan={plan} />
      <Dialog open={showEducationPricingConfirm} onOpenChange={setShowEducationPricingConfirm}>
        <DialogContent backdropProps={{ forceRender: true }} className="w-130">
          <DialogClose
            render={
              <IconButton
                aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                size="lg"
                className="absolute top-6 right-6"
              >
                <span aria-hidden className="i-ri-close-line size-4" />
              </IconButton>
            }
          />
          <div className="flex flex-col gap-2 pr-10">
            <DialogTitle className="w-full title-2xl-semi-bold text-text-primary">
              {t(($) => $['educationPricingConfirm.title'], { ns: 'education' })}
            </DialogTitle>
            <DialogDescription className="w-full system-md-regular text-text-tertiary">
              {t(($) => $['educationPricingConfirm.description'], { ns: 'education' })}
            </DialogDescription>
          </div>
          <div className="mt-10 flex items-start justify-end gap-3">
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
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
