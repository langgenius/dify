'use client'
import type { FC } from 'react'
import type { BasicPlan } from '../../../type'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { toast } from '@langgenius/dify-ui/toast'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import { useAsyncWindowOpen } from '@/hooks/use-async-window-open'
import { fetchSubscriptionUrls } from '@/service/billing'
import { consoleClient } from '@/service/client'
import { ALL_PLANS } from '../../../config'
import { useEducationDiscount } from '../../../hooks/use-education-discount'
import { Plan } from '../../../type'
import { Professional, Sandbox, Team } from '../../assets'
import { PlanRange } from '../../plan-switcher/plan-range-switcher'
import Button from './button'
import List from './list'

const ICON_MAP = {
  [Plan.sandbox]: <Sandbox />,
  [Plan.professional]: <Professional />,
  [Plan.team]: <Team />,
}

type ConfirmType = {
  type: 'info' | 'warning'
}

type CloudPlanItemProps = {
  currentPlan: BasicPlan
  plan: BasicPlan
  planRange: PlanRange
  canPay: boolean
}

const CloudPlanItem: FC<CloudPlanItemProps> = ({
  plan,
  currentPlan,
  planRange,
  canPay,
}) => {
  const { t } = useTranslation()
  const [loading, setLoading] = React.useState(false)
  const i18nPrefix = `plans.${plan}` as const
  const isFreePlan = plan === Plan.sandbox
  const isMostPopularPlan = plan === Plan.professional
  const planInfo = ALL_PLANS[plan]
  const isYear = planRange === PlanRange.yearly
  const isCurrent = plan === currentPlan
  const isCurrentPaidPlan = isCurrent && !isFreePlan
  const isPlanDisabled = isCurrentPaidPlan ? false : planInfo.level <= ALL_PLANS[currentPlan].level
  const { isCurrentWorkspaceManager } = useAppContext()
  const { enableEducationPlan, isEducationAccount } = useProviderContext()
  const isEducationDiscountMode = enableEducationPlan && isEducationAccount
  const isEducationDiscountSupportedPlan = plan === Plan.professional && isYear
  const selectedPlanName = t(`${i18nPrefix}.name`, { ns: 'billing' })
  const selectedBillingPeriod = t(`educationPricingConfirm.billingPeriod.${isYear ? 'yearly' : 'monthly'}`, { ns: 'education' })
  const educationDiscountWarningText = canPay && isEducationDiscountMode && !isFreePlan && !isEducationDiscountSupportedPlan
    ? t('planNotSupportEducationDiscount', { ns: 'education' })
    : undefined
  const openAsyncWindow = useAsyncWindowOpen()
  const { handleEducationDiscount, isEducationDiscountLoading } = useEducationDiscount()
  const [showEducationPricingConfirm, setShowEducationPricingConfirm] = React.useState(false)
  const educationPricingConfirmInfo: ConfirmType = { type: 'warning' }

  const btnText = useMemo(() => {
    if (canPay && isEducationDiscountMode && isEducationDiscountSupportedPlan && !isCurrent)
      return t('useEducationDiscount', { ns: 'education' })

    if (isCurrent)
      return t('plansCommon.currentPlan', { ns: 'billing' })

    return ({
      [Plan.sandbox]: t('plansCommon.startForFree', { ns: 'billing' }),
      [Plan.professional]: t('plansCommon.startBuilding', { ns: 'billing' }),
      [Plan.team]: t('plansCommon.getStarted', { ns: 'billing' }),
    })[plan]
  }, [canPay, isCurrent, isEducationDiscountMode, isEducationDiscountSupportedPlan, plan, t])

  const handlePayCurrentPlan = async () => {
    if (loading || isEducationDiscountLoading)
      return

    if (isPlanDisabled)
      return

    if (isEducationDiscountMode && isEducationDiscountSupportedPlan && !isCurrentPaidPlan) {
      await handleEducationDiscount()
      return
    }

    if (!isCurrentWorkspaceManager) {
      toast.error(t('buyPermissionDeniedTip', { ns: 'billing' }))
      return
    }
    setLoading(true)
    try {
      if (isCurrentPaidPlan) {
        await openAsyncWindow(async () => {
          const res = await consoleClient.billing.invoices()
          if (res.url)
            return res.url
          throw new Error('Failed to open billing page')
        }, {
          onError: (err) => {
            toast.error(err.message || String(err))
          },
        })
        return
      }

      if (isFreePlan)
        return

      const res = await fetchSubscriptionUrls(plan, isYear ? 'year' : 'month')
      // Adb Block additional tracking block the gtag, so we need to redirect directly
      window.location.href = res.url
    }
    finally {
      setLoading(false)
    }
  }
  const handleGetPayUrl = async () => {
    if (educationDiscountWarningText && !isPlanDisabled) {
      setShowEducationPricingConfirm(true)
      return
    }

    await handlePayCurrentPlan()
  }
  const handleContinueCurrentPlan = async () => {
    setShowEducationPricingConfirm(false)
    await handlePayCurrentPlan()
  }
  return (
    <div className="flex min-w-0 flex-1 flex-col pb-3">
      <div className="flex flex-col px-5 py-4">
        <div className="flex flex-col gap-y-6 px-1 pt-10">
          {ICON_MAP[plan]}
          <div className="flex min-h-[104px] flex-col gap-y-2">
            <div className="flex items-center gap-x-2.5">
              <div className="text-[30px] leading-[1.2] font-medium text-text-primary">{t(`${i18nPrefix}.name`, { ns: 'billing' })}</div>
              {
                isMostPopularPlan && (
                  <div className="flex items-center justify-center bg-saas-dify-blue-static px-1.5 py-1">
                    <span className="system-2xs-semibold-uppercase text-text-primary-on-surface">
                      {t('plansCommon.mostPopular', { ns: 'billing' })}
                    </span>
                  </div>
                )
              }
            </div>
            <div className="system-sm-regular text-text-secondary">{t(`${i18nPrefix}.description`, { ns: 'billing' })}</div>
          </div>
        </div>
        {/* Price */}
        <div className="flex items-end gap-x-2 px-1 pt-4 pb-8">
          {isFreePlan && (
            <span className="title-4xl-semi-bold text-text-primary">{t('plansCommon.free', { ns: 'billing' })}</span>
          )}
          {!isFreePlan && (
            <>
              {isYear && (
                <span className="title-4xl-semi-bold text-text-quaternary line-through">
                  $
                  {planInfo.price * 12}
                </span>
              )}
              <span className="title-4xl-semi-bold text-text-primary">
                $
                {isYear ? planInfo.price * 10 : planInfo.price}
              </span>
              <span className="pb-0.5 system-md-regular text-text-tertiary">
                {t('plansCommon.priceTip', { ns: 'billing' })}
                {t(`plansCommon.${!isYear ? 'month' : 'year'}`, { ns: 'billing' })}
              </span>
            </>
          )}
        </div>
        <Button
          plan={plan}
          isPlanDisabled={isPlanDisabled}
          btnText={btnText}
          handleGetPayUrl={handleGetPayUrl}
          warningText={educationDiscountWarningText}
        />
      </div>
      <List plan={plan} />
      <AlertDialog
        open={showEducationPricingConfirm}
        onOpenChange={setShowEducationPricingConfirm}
      >
        {showEducationPricingConfirm && <div className="fixed inset-0 z-1002 bg-background-overlay"></div>}
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t('educationPricingConfirm.title', { ns: 'education' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {t('educationPricingConfirm.description', {
                ns: 'education',
                planName: selectedPlanName,
                billingPeriod: selectedBillingPeriod,
              })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton
              onClick={() => setShowEducationPricingConfirm(false)}
              disabled={loading}
            >
              {t('educationPricingConfirm.cancel', { ns: 'education' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              tone={educationPricingConfirmInfo.type !== 'info' ? 'destructive' : 'default'}
              onClick={handleContinueCurrentPlan}
              disabled={loading}
              loading={loading}
            >
              {t('educationPricingConfirm.continue', { ns: 'education' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
export default React.memo(CloudPlanItem)
