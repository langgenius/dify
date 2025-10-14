'use client'
import type { FC } from 'react'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { BasicPlan } from '../../../type'
import { Plan } from '../../../type'
import { ALL_PLANS } from '../../../config'
import Toast from '../../../../base/toast'
import { PlanRange } from '../../plan-switcher/plan-range-switcher'
import { useAppContext } from '@/context/app-context'
import { fetchSubscriptionUrls } from '@/service/billing'
import List from './list'
import Button from './button'
import { Professional, Sandbox, Team } from '../../assets'

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
  const i18nPrefix = `billing.plans.${plan}`
  const isFreePlan = plan === Plan.sandbox
  const isMostPopularPlan = plan === Plan.professional
  const planInfo = ALL_PLANS[plan]
  const isYear = planRange === PlanRange.yearly
  const isCurrent = plan === currentPlan
  const isPlanDisabled = planInfo.level <= ALL_PLANS[currentPlan].level
  const { isCurrentWorkspaceManager } = useAppContext()

  const btnText = useMemo(() => {
    if (isCurrent)
      return t('billing.plansCommon.currentPlan')

    return ({
      [Plan.sandbox]: t('billing.plansCommon.startForFree'),
      [Plan.professional]: t('billing.plansCommon.startBuilding'),
      [Plan.team]: t('billing.plansCommon.getStarted'),
    })[plan]
  }, [isCurrent, plan, t])

  const handleGetPayUrl = async () => {
    if (loading)
      return

    if (isPlanDisabled)
      return

    if (isFreePlan)
      return

    // Only workspace manager can buy plan
    if (!isCurrentWorkspaceManager) {
      Toast.notify({
        type: 'error',
        message: t('billing.buyPermissionDeniedTip'),
        className: 'z-[1001]',
      })
      return
    }
    setLoading(true)
    try {
      const res = await fetchSubscriptionUrls(plan, isYear ? 'year' : 'month')
      // Adb Block additional tracking block the gtag, so we need to redirect directly
      window.location.href = res.url
    }
    finally {
      setLoading(false)
    }
  }
  return (
    <div className='flex min-w-0 flex-1 flex-col pb-3'>
      <div className='flex flex-col px-5 py-4'>
        <div className='flex flex-col gap-y-6 px-1 pt-10'>
          {ICON_MAP[plan]}
          <div className='flex min-h-[104px] flex-col gap-y-2'>
            <div className='flex items-center gap-x-2.5'>
              <div className='text-[30px] font-medium leading-[1.2] text-text-primary'>{t(`${i18nPrefix}.name`)}</div>
              {
                isMostPopularPlan && (
                  <div className='flex items-center justify-center bg-saas-dify-blue-static px-1.5 py-1'>
                    <span className='system-2xs-semibold-uppercase text-text-primary-on-surface'>
                      {t('billing.plansCommon.mostPopular')}
                    </span>
                  </div>
                )
              }
            </div>
            <div className='system-sm-regular text-text-secondary'>{t(`${i18nPrefix}.description`)}</div>
          </div>
        </div>
        {/* Price */}
        <div className='flex items-end gap-x-2 px-1 pb-8 pt-4'>
          {isFreePlan && (
            <span className='title-4xl-semi-bold text-text-primary'>{t('billing.plansCommon.free')}</span>
          )}
          {!isFreePlan && (
            <>
              {isYear && <span className='title-4xl-semi-bold text-text-quaternary line-through'>${planInfo.price * 12}</span>}
              <span className='title-4xl-semi-bold text-text-primary'>${isYear ? planInfo.price * 10 : planInfo.price}</span>
              <span className='system-md-regular pb-0.5 text-text-tertiary'>
                {t('billing.plansCommon.priceTip')}
                {t(`billing.plansCommon.${!isYear ? 'month' : 'year'}`)}
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
