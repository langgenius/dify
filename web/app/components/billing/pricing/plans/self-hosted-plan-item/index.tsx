'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { SelfHostedPlan } from '../../../type'
import { contactSalesUrl, getStartedWithCommunityUrl, getWithPremiumUrl } from '../../../config'
import Toast from '../../../../base/toast'
import cn from '@/utils/classnames'
import { useAppContext } from '@/context/app-context'
import Button from './button'
import List from './list'
import { Azure, GoogleCloud } from '@/app/components/base/icons/src/public/billing'

const style = {
  [SelfHostedPlan.community]: {
    icon: <div className='size-[60px] bg-black' />,
    bg: '',
    btnStyle: 'bg-components-button-secondary-bg hover:bg-components-button-secondary-bg-hover border-[0.5px] border-components-button-secondary-border text-text-primary',
    values: 'text-text-secondary',
    tooltipIconColor: 'text-text-tertiary',
  },
  [SelfHostedPlan.premium]: {
    icon: <div className='size-[60px] bg-black' />,
    bg: '',
    btnStyle: 'bg-third-party-aws hover:bg-third-party-aws-hover border border-components-button-primary-border text-text-primary-on-surface shadow-xs',
    values: 'text-text-secondary',
    tooltipIconColor: 'text-text-tertiary',
  },
  [SelfHostedPlan.enterprise]: {
    icon: <div className='size-[60px] bg-black' />,
    bg: '',
    btnStyle: 'bg-white/96 hover:opacity-85 border-[0.5px] border-components-button-secondary-border text-[#155AEF] shadow-xs',
    values: 'text-text-primary-on-surface',
    tooltipIconColor: 'text-text-primary-on-surface',
  },
}

type SelfHostedPlanItemProps = {
  plan: SelfHostedPlan
}

const SelfHostedPlanItem: FC<SelfHostedPlanItemProps> = ({
  plan,
}) => {
  const { t } = useTranslation()
  const i18nPrefix = `billing.plans.${plan}`
  const isFreePlan = plan === SelfHostedPlan.community
  const isPremiumPlan = plan === SelfHostedPlan.premium
  const isEnterprisePlan = plan === SelfHostedPlan.enterprise
  const { isCurrentWorkspaceManager } = useAppContext()

  const handleGetPayUrl = useCallback(() => {
    // Only workspace manager can buy plan
    if (!isCurrentWorkspaceManager) {
      Toast.notify({
        type: 'error',
        message: t('billing.buyPermissionDeniedTip'),
        className: 'z-[1001]',
      })
      return
    }
    if (isFreePlan) {
      window.location.href = getStartedWithCommunityUrl
      return
    }
    if (isPremiumPlan) {
      window.location.href = getWithPremiumUrl
      return
    }

    if (isEnterprisePlan)
      window.location.href = contactSalesUrl
  }, [isCurrentWorkspaceManager, isFreePlan, isPremiumPlan, isEnterprisePlan, t])

  return (
    <div className={cn(
      'flex flex-1 flex-col',
      style[plan].bg,
    )}>
      <div className='flex flex-col px-5 py-4'>
        <div className=' flex flex-col gap-y-6 px-1 pt-10'>
          {style[plan].icon}
          <div className='flex min-h-[104px] flex-col gap-y-2'>
            <div className='text-[30px] font-medium leading-[1.2] text-text-primary'>{t(`${i18nPrefix}.name`)}</div>
            <div className='system-md-regular line-clamp-2 text-text-secondary'>{t(`${i18nPrefix}.description`)}</div>
          </div>
        </div>
        {/* Price */}
        <div className='mx-1 mb-8 mt-4 flex items-end gap-x-2'>
          <div className='title-4xl-semi-bold shrink-0 text-text-primary'>{t(`${i18nPrefix}.price`)}</div>
          {!isFreePlan && (
            <span className='system-md-regular pb-0.5 text-text-tertiary'>
              {t(`${i18nPrefix}.priceTip`)}
            </span>
          )}
        </div>
        <Button
          plan={plan}
          handleGetPayUrl={handleGetPayUrl}
        />
      </div>
      <List plan={plan} />
      {isPremiumPlan && (
        <div className='flex grow flex-col justify-end gap-y-2 p-6 pt-0'>
          <div className='flex items-center gap-x-1'>
            <div className='flex size-8 items-center justify-center rounded-lg border-[0.5px] border-components-panel-border-subtle bg-background-default shadow-xs shadow-shadow-shadow-3'>
              <Azure />
            </div>
            <div className='flex size-8 items-center justify-center rounded-lg border-[0.5px] border-components-panel-border-subtle bg-background-default shadow-xs shadow-shadow-shadow-3'>
              <GoogleCloud />
            </div>
          </div>
          <span className='system-xs-regular text-text-tertiary'>
            {t('billing.plans.premium.comingSoon')}
          </span>
        </div>
      )}
    </div>
  )
}
export default React.memo(SelfHostedPlanItem)
