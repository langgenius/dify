'use client'
import type { FC } from 'react'
import type { BasicPlan } from '../../../type'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppContext } from '@/context/app-context'
import { useAsyncWindowOpen } from '@/hooks/use-async-window-open'
import { fetchSubscriptionUrls } from '@/service/billing'
import { consoleClient } from '@/service/client'
import Toast from '../../../../base/toast'
import { ALL_PLANS } from '../../../config'
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
  const openAsyncWindow = useAsyncWindowOpen()

  const btnText = useMemo(() => {
    if (isCurrent)
      return t('plansCommon.currentPlan', { ns: 'billing' })

    return ({
      [Plan.sandbox]: t('plansCommon.startForFree', { ns: 'billing' }),
      [Plan.professional]: t('plansCommon.startBuilding', { ns: 'billing' }),
      [Plan.team]: t('plansCommon.getStarted', { ns: 'billing' }),
    })[plan]
  }, [isCurrent, plan, t])

  const handleGetPayUrl = async () => {
    if (loading)
      return

    if (isPlanDisabled)
      return

    if (!isCurrentWorkspaceManager) {
      Toast.notify({
        type: 'error',
        message: t('buyPermissionDeniedTip', { ns: 'billing' }),
        className: 'z-[1001]',
      })
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
            Toast.notify({ type: 'error', message: err.message || String(err) })
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
  return (
    <div className="flex min-w-0 flex-1 flex-col pb-3">
      <div className="flex flex-col px-5 py-4">
        <div className="flex flex-col gap-y-6 px-1 pt-10">
          {ICON_MAP[plan]}
          <div className="flex min-h-[104px] flex-col gap-y-2">
            <div className="flex items-center gap-x-2.5">
              <div className="text-[30px] font-medium leading-[1.2] text-text-primary">{t(`${i18nPrefix}.name`, { ns: 'billing' })}</div>
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
        <div className="flex items-end gap-x-2 px-1 pb-8 pt-4">
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
              <span className="system-md-regular pb-0.5 text-text-tertiary">
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
        />
      </div>
      <List plan={plan} />
    </div>
  )
}
export default React.memo(CloudPlanItem)
