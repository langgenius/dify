'use client'
import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type { FC } from 'react'
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
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useProviderContext } from '@/context/provider-context'
import { useAsyncWindowOpen } from '@/hooks/use-async-window-open'
import { consoleClient, consoleQuery } from '@/service/client'
import { ALL_PLANS } from '../../../config'
import { useEducationDiscount } from '../../../hooks/use-education-discount'
import { Professional, Sandbox, Team } from '../../assets'
import { PlanRange } from '../../plan-switcher/plan-range-switcher'
import PlanButton from './button'
import List from './list'

const ICON_MAP = {
  sandbox: <Sandbox />,
  professional: <Professional />,
  team: <Team />,
}

type CloudPlanItemProps = {
  currentPlan: CloudPlan
  plan: CloudPlan
  planRange: PlanRange
  canPay: boolean
}

const CloudPlanItem: FC<CloudPlanItemProps> = ({ plan, currentPlan, planRange, canPay }) => {
  const { t } = useTranslation()
  const [loading, setLoading] = React.useState(false)
  const i18nPrefix = `plans.${plan}` as const
  const isFreePlan = plan === 'sandbox'
  const isMostPopularPlan = plan === 'professional'
  const planInfo = ALL_PLANS[plan]
  const isYear = planRange === PlanRange.yearly
  const isCurrent = plan === currentPlan
  const isCurrentPaidPlan = isCurrent && !isFreePlan
  const isPlanDisabled = isCurrentPaidPlan ? false : planInfo.level <= ALL_PLANS[currentPlan].level
  const { enableEducationPlan } = useProviderContext()
  const { data: isEducationAccount = false } = useQuery(
    consoleQuery.account.education.get.queryOptions({
      enabled: enableEducationPlan,
      select: ({ is_student }) => is_student ?? false,
    }),
  )
  const isEducationDiscountMode = enableEducationPlan && isEducationAccount
  const isEducationDiscountSupportedPlan = plan === 'professional' && isYear
  const educationDiscountWarningText =
    canPay && isEducationDiscountMode && !isFreePlan && !isEducationDiscountSupportedPlan
      ? t(($) => $.planNotSupportEducationDiscount, { ns: 'education' })
      : undefined
  const openAsyncWindow = useAsyncWindowOpen()
  const { handleEducationDiscount, isEducationDiscountLoading } = useEducationDiscount()
  const [showEducationPricingConfirm, setShowEducationPricingConfirm] = React.useState(false)

  const btnText = useMemo(() => {
    if (canPay && isEducationDiscountMode && isEducationDiscountSupportedPlan && !isCurrent)
      return t(($) => $.useEducationDiscount, { ns: 'education' })

    if (isCurrent) return t(($) => $['plansCommon.currentPlan'], { ns: 'billing' })

    return {
      sandbox: t(($) => $['plansCommon.startForFree'], { ns: 'billing' }),
      professional: t(($) => $['plansCommon.startBuilding'], { ns: 'billing' }),
      team: t(($) => $['plansCommon.getStarted'], { ns: 'billing' }),
    }[plan]
  }, [canPay, isCurrent, isEducationDiscountMode, isEducationDiscountSupportedPlan, plan, t])

  const handlePayCurrentPlan = async () => {
    if (loading || isEducationDiscountLoading) return

    if (isPlanDisabled) return

    setLoading(true)
    try {
      if (isCurrentPaidPlan) {
        if (!canPay) {
          toast.error(t(($) => $.buyPermissionDeniedTip, { ns: 'billing' }))
          return
        }

        await openAsyncWindow(
          async () => {
            const res = await consoleClient.billing.invoices.get()
            if (res.url) return res.url
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

      if (!canPay) {
        toast.error(t(($) => $.buyPermissionDeniedTip, { ns: 'billing' }))
        return
      }

      if (isEducationDiscountMode && isEducationDiscountSupportedPlan) {
        await handleEducationDiscount()
        return
      }

      const res = await consoleClient.billing.subscription.get({
        query: { plan, interval: isYear ? 'year' : 'month' },
      })
      // Adb Block additional tracking block the gtag, so we need to redirect directly
      window.location.href = res.url
    } finally {
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
  const handleSwitchToProfessionalAnnual = async () => {
    await handleEducationDiscount()
  }
  const handleKeepCurrentPlan = async () => {
    await handlePayCurrentPlan()
    setShowEducationPricingConfirm(false)
  }
  return (
    <div className="flex min-w-0 flex-1 flex-col pb-3">
      <div className="flex flex-col px-5 py-4">
        <div className="flex flex-col gap-y-6 px-1 pt-10">
          {ICON_MAP[plan]}
          <div className="flex min-h-26 flex-col gap-y-2">
            <div className="flex items-center gap-x-2.5">
              <div className="text-[30px] leading-[1.2] font-medium text-text-primary">
                {t(($) => $[`${i18nPrefix}.name`], { ns: 'billing' })}
              </div>
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
              {isYear && (
                <span className="title-4xl-semi-bold text-text-quaternary line-through">
                  ${planInfo.price * 12}
                </span>
              )}
              <span className="title-4xl-semi-bold text-text-primary">
                ${isYear ? planInfo.price * 10 : planInfo.price}
              </span>
              <span className="pb-0.5 system-md-regular text-text-tertiary">
                {t(($) => $['plansCommon.priceTip'], { ns: 'billing' })}
                {t(($) => $[`plansCommon.${!isYear ? 'month' : 'year'}`], { ns: 'billing' })}
              </span>
            </>
          )}
        </div>
        <PlanButton
          plan={plan}
          isPlanDisabled={isPlanDisabled}
          btnText={btnText}
          handleGetPayUrl={handleGetPayUrl}
          warningText={educationDiscountWarningText}
        />
      </div>
      <List plan={plan} />
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
              onClick={handleKeepCurrentPlan}
              disabled={loading || isEducationDiscountLoading}
              loading={loading}
              className="min-w-38"
            >
              {t(($) => $['educationPricingConfirm.cancel'], { ns: 'education' })}
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={handleSwitchToProfessionalAnnual}
              disabled={isEducationDiscountLoading}
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
export default React.memo(CloudPlanItem)
