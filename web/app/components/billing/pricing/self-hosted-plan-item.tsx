'use client'
import type { FC, ReactNode } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { RiArrowRightUpLine, RiBrain2Line, RiCheckLine, RiQuestionLine } from '@remixicon/react'
import { SelfHostedPlan } from '../type'
import { contactSalesUrl, getStartedWithCommunityUrl, getWithPremiumUrl } from '../config'
import Toast from '../../base/toast'
import Tooltip from '../../base/tooltip'
import { Asterisk, AwsMarketplace, Azure, Buildings, Diamond, GoogleCloud } from '../../base/icons/src/public/billing'
import type { PlanRange } from './select-plan-range'
import cn from '@/utils/classnames'
import { useAppContext } from '@/context/app-context'

type Props = {
  plan: SelfHostedPlan
  planRange: PlanRange
  canPay: boolean
}

const KeyValue = ({ label, tooltip, textColor, tooltipIconColor }: { icon: ReactNode; label: string; tooltip?: string; textColor: string; tooltipIconColor: string }) => {
  return (
    <div className={cn('flex', textColor)}>
      <div className='size-4 flex items-center justify-center'>
        <RiCheckLine />
      </div>
      <div className={cn('ml-2 mr-0.5 system-sm-regular', textColor)}>{label}</div>
      {tooltip && (
        <Tooltip
          asChild
          popupContent={tooltip}
          popupClassName='w-[200px]'
        >
          <div className='size-4 flex items-center justify-center'>
            <RiQuestionLine className={cn(tooltipIconColor)} />
          </div>
        </Tooltip>
      )}
    </div>
  )
}

const style = {
  [SelfHostedPlan.community]: {
    icon: <Asterisk className='text-text-primary size-7' />,
    title: 'text-text-primary',
    price: 'text-text-primary',
    priceTip: 'text-text-tertiary',
    description: 'text-util-colors-gray-gray-600',
    bg: 'border-effects-highlight-lightmode-off bg-background-section-burn',
    btnStyle: 'bg-components-button-secondary-bg hover:bg-components-button-secondary-bg-hover border-[0.5px] border-components-button-secondary-border text-text-primary',
    values: 'text-text-secondary',
    tooltipIconColor: 'text-text-tertiary',
  },
  [SelfHostedPlan.premium]: {
    icon: <Diamond className='text-text-warning size-7' />,
    title: 'text-text-primary',
    price: 'text-text-primary',
    priceTip: 'text-text-tertiary',
    description: 'text-text-warning',
    bg: 'border-effects-highlight bg-background-section-burn',
    btnStyle: 'bg-third-party-aws hover:bg-third-party-aws-hover border border-components-button-primary-border text-text-primary-on-surface shadow-xs',
    values: 'text-text-secondary',
    tooltipIconColor: 'text-text-tertiary',
  },
  [SelfHostedPlan.enterprise]: {
    icon: <Buildings className='text-text-primary-on-surface size-7' />,
    title: 'text-text-primary-on-surface',
    price: 'text-text-primary-on-surface',
    priceTip: 'text-text-primary-on-surface',
    description: 'text-text-primary-on-surface',
    bg: 'border-effects-highlight bg-[#155AEF] text-text-primary-on-surface',
    btnStyle: 'bg-white bg-opacity-96 hover:opacity-85 border-[0.5px] border-components-button-secondary-border text-[#155AEF] shadow-xs',
    values: 'text-text-primary-on-surface',
    tooltipIconColor: 'text-text-primary-on-surface',
  },
}
const SelfHostedPlanItem: FC<Props> = ({
  plan,
}) => {
  const { t } = useTranslation()
  const isFreePlan = plan === SelfHostedPlan.community
  const isPremiumPlan = plan === SelfHostedPlan.premium
  const i18nPrefix = `billing.plans.${plan}`
  const isEnterprisePlan = plan === SelfHostedPlan.enterprise
  const { isCurrentWorkspaceManager } = useAppContext()
  const features = t(`${i18nPrefix}.features`, { returnObjects: true }) as string[]
  const handleGetPayUrl = () => {
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
  }
  return (
    <div className={cn(`relative flex flex-col w-[374px] border-[0.5px] rounded-2xl
      hover:shadow-lg hover:backdrop-blur-[5px] hover:border-effects-highlight overflow-hidden`, style[plan].bg)}>
      <div>
        <div className={cn(isEnterprisePlan ? 'bg-price-enterprise-background absolute left-0 top-0 right-0 bottom-0 z-1' : '')} >
        </div>
        {isEnterprisePlan && <div className='bg-[#09328c] opacity-15 mix-blend-plus-darker blur-[80px] size-[341px] rounded-full absolute -top-[104px] -left-[90px] z-15'></div>}
        {isEnterprisePlan && <div className='bg-[#e2eafb] opacity-15 mix-blend-plus-darker blur-[80px] size-[341px] rounded-full absolute -right-[40px] -bottom-[72px] z-15'></div>}
      </div>
      <div className='relative w-full p-6 z-10 min-h-[559px]'>
        <div className=' flex flex-col gap-y-1 min-h-[108px]'>
          {style[plan].icon}
          <div className='flex items-center'>
            <div className={cn('leading-[125%] system-md-semibold uppercase', style[plan].title)}>{t(`${i18nPrefix}.name`)}</div>
          </div>
          <div className={cn(style[plan].description, 'system-sm-regular')}>{t(`${i18nPrefix}.description`)}</div>
        </div>
        <div className='my-3'>
          <div className='flex items-end'>
            <div className={cn('leading-[125%] text-[28px] font-bold shrink-0', style[plan].price)}>{t(`${i18nPrefix}.price`)}</div>
            {!isFreePlan
              && <span className={cn('ml-2 py-1 leading-normal text-[14px] font-normal', style[plan].priceTip)}>
                {t(`${i18nPrefix}.priceTip`)}
              </span>}
          </div>
        </div>

        <div
          className={cn('flex py-3 px-5 rounded-full justify-center items-center h-[44px] system-md-semibold cursor-pointer',
            style[plan].btnStyle)}
          onClick={handleGetPayUrl}
        >
          {t(`${i18nPrefix}.btnText`)}
          {isPremiumPlan
            && <>
              <div className='pt-[6px] mx-1'>
                <AwsMarketplace className='h-6' />
              </div>
              <RiArrowRightUpLine className='size-4' />
            </>}
        </div>
        <div className={cn('mt-6 system-sm-semibold mb-2', style[plan].values)}>{t(`${i18nPrefix}.includesTitle`)}</div>
        <div className='flex flex-col gap-y-3'>
          {features.map(v =>
            <KeyValue key={`${plan}-${v}`}
              textColor={style[plan].values}
              tooltipIconColor={style[plan].tooltipIconColor}
              icon={<RiBrain2Line />}
              label={v}
            />)}
        </div>
        {isPremiumPlan && <div className='mt-[68px]'>
          <div className='flex items-center gap-x-1'>
            <div className='size-8 flex items-center justify-center rounded-lg border-[0.5px] border-components-panel-border-subtle bg-background-default shadow-xs'>
              <Azure />
            </div>
            <div className='size-8 flex items-center justify-center rounded-lg border-[0.5px] border-components-panel-border-subtle bg-background-default shadow-xs'>
              <GoogleCloud />
            </div>
          </div>
          <span className={cn('mt-2 system-xs-regular', style[plan].tooltipIconColor)}>{t('billing.plans.premium.comingSoon')}</span>
        </div>}
      </div>
    </div>
  )
}
export default React.memo(SelfHostedPlanItem)
