'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import { useContext } from 'use-context-selector'
import { Plan } from '../type'
import { ALL_PLANS, NUM_INFINITE, contactSalesUrl, contractSales, unAvailable } from '../config'
import Toast from '../../base/toast'
import TooltipPlus from '../../base/tooltip-plus'
import { PlanRange } from './select-plan-range'
import { HelpCircle } from '@/app/components/base/icons/src/vender/line/general'
import { useAppContext } from '@/context/app-context'
import { fetchSubscriptionUrls } from '@/service/billing'
import { LanguagesSupportedUnderscore, getModelRuntimeSupported } from '@/utils/language'
import I18n from '@/context/i18n'

type Props = {
  currentPlan: Plan
  plan: Plan
  planRange: PlanRange
  canPay: boolean
}

const KeyValue = ({ label, value, tooltip }: { label: string; value: string | number | JSX.Element; tooltip?: string }) => {
  return (
    <div className='mt-3.5 leading-[125%] text-[13px] font-medium'>
      <div className='flex items-center text-gray-500 space-x-1'>
        <div>{label}</div>
        {tooltip && (
          <TooltipPlus
            popupContent={
              <div className='w-[200px]'>{tooltip}</div>
            }
          >
            <HelpCircle className='w-3 h-3 text-gray-400' />
          </TooltipPlus>
        )}
      </div>
      <div className='mt-0.5 text-gray-900'>{value}</div>
    </div>
  )
}

const priceClassName = 'leading-[32px] text-[28px] font-bold text-gray-900'
const style = {
  [Plan.sandbox]: {
    bg: 'bg-[#F2F4F7]',
    title: 'text-gray-900',
    hoverAndActive: '',
  },
  [Plan.professional]: {
    bg: 'bg-[#E0F2FE]',
    title: 'text-[#026AA2]',
    hoverAndActive: 'hover:shadow-lg hover:!text-white hover:!bg-[#0086C9] hover:!border-[#026AA2] active:!text-white active:!bg-[#026AA2] active:!border-[#026AA2]',
  },
  [Plan.team]: {
    bg: 'bg-[#E0EAFF]',
    title: 'text-[#3538CD]',
    hoverAndActive: 'hover:shadow-lg hover:!text-white hover:!bg-[#444CE7] hover:!border-[#3538CD] active:!text-white active:!bg-[#3538CD] active:!border-[#3538CD]',
  },
  [Plan.enterprise]: {
    bg: 'bg-[#FFEED3]',
    title: 'text-[#DC6803]',
    hoverAndActive: 'hover:shadow-lg hover:!text-white hover:!bg-[#F79009] hover:!border-[#DC6803] active:!text-white active:!bg-[#DC6803] active:!border-[#DC6803]',
  },
}
const PlanItem: FC<Props> = ({
  plan,
  currentPlan,
  planRange,
  canPay,
}) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const language = getModelRuntimeSupported(locale)
  const isZh = language === LanguagesSupportedUnderscore[1]
  const [loading, setLoading] = React.useState(false)
  const i18nPrefix = `billing.plans.${plan}`
  const isFreePlan = plan === Plan.sandbox
  const isEnterprisePlan = plan === Plan.enterprise
  const isMostPopularPlan = plan === Plan.professional
  const planInfo = ALL_PLANS[plan]
  const isYear = planRange === PlanRange.yearly
  const isCurrent = plan === currentPlan
  const isPlanDisabled = planInfo.level <= ALL_PLANS[currentPlan].level || (!canPay && plan !== Plan.enterprise)
  const { isCurrentWorkspaceManager } = useAppContext()
  const messagesRequest = (() => {
    const value = planInfo.messageRequest[isZh ? 'zh' : 'en']
    if (value === contractSales)
      return t('billing.plansCommon.contractSales')

    return value
  })()
  const btnText = (() => {
    if (!canPay && plan !== Plan.enterprise)
      return t('billing.plansCommon.contractOwner')

    if (isCurrent)
      return t('billing.plansCommon.currentPlan')

    return ({
      [Plan.sandbox]: t('billing.plansCommon.startForFree'),
      [Plan.professional]: <>{t('billing.plansCommon.getStartedWith')}<span className='capitalize'>&nbsp;{plan}</span></>,
      [Plan.team]: <>{t('billing.plansCommon.getStartedWith')}<span className='capitalize'>&nbsp;{plan}</span></>,
      [Plan.enterprise]: t('billing.plansCommon.talkToSales'),
    })[plan]
  })()
  const comingSoon = (
    <div className='leading-[12px] text-[9px] font-semibold text-[#3538CD] uppercase'>{t('billing.plansCommon.comingSoon')}</div>
  )
  const supportContent = (() => {
    switch (plan) {
      case Plan.sandbox:
        return (<div className='space-y-3.5'>
          <div>{t('billing.plansCommon.supportItems.communityForums')}</div>
          <div>{t('billing.plansCommon.supportItems.agentMode')}</div>
          <div className='flex items-center space-x-1'>
            <div className='flex items-center'>
              <div className='mr-0.5'>&nbsp;{t('billing.plansCommon.supportItems.workflow')}</div>
            </div>
            <div>{comingSoon}</div>
          </div>
        </div>)
      case Plan.professional:
        return (
          <div>
            <div>{t('billing.plansCommon.supportItems.emailSupport')}</div>
            <div className='mt-3.5 flex items-center space-x-1'>
              <div>+ {t('billing.plansCommon.supportItems.logoChange')}</div>
            </div>
            <div className='mt-3.5 flex items-center space-x-1'>
              <div className='flex items-center'>
                +
                <div className='mr-0.5'>&nbsp;{t('billing.plansCommon.supportItems.ragAPIRequest')}</div>
                <TooltipPlus
                  popupContent={
                    <div className='w-[200px]'>{t('billing.plansCommon.ragAPIRequestTooltip')}</div>
                  }
                >
                  <HelpCircle className='w-3 h-3 text-gray-400' />
                </TooltipPlus>
              </div>
              <div>{comingSoon}</div>
            </div>
          </div>
        )
      case Plan.team:
        return (
          <div>
            <div>{t('billing.plansCommon.supportItems.priorityEmail')}</div>
            <div className='mt-3.5 flex items-center space-x-1'>
              <div>+ {t('billing.plansCommon.supportItems.SSOAuthentication')}</div>
              <div>{comingSoon}</div>
            </div>
          </div>
        )
      case Plan.enterprise:
        return (
          <div>
            <div>{t('billing.plansCommon.supportItems.personalizedSupport')}</div>
            <div className='mt-3.5 flex items-center space-x-1'>
              <div>+ {t('billing.plansCommon.supportItems.dedicatedAPISupport')}</div>
            </div>
            <div className='mt-3.5 flex items-center space-x-1'>
              <div>+ {t('billing.plansCommon.supportItems.customIntegration')}</div>
            </div>
          </div>
        )
      default:
        return ''
    }
  })()
  const handleGetPayUrl = async () => {
    if (loading)
      return

    if (isPlanDisabled)
      return

    if (isFreePlan)
      return

    if (isEnterprisePlan) {
      window.location.href = contactSalesUrl
      return
    }
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
    <div className={cn(isMostPopularPlan ? 'bg-[#0086C9] p-0.5' : 'pt-7', 'flex flex-col min-w-[290px] w-[290px] rounded-xl')}>
      {isMostPopularPlan && (
        <div className='flex items-center h-7 justify-center leading-[12px] text-xs font-medium text-[#F5F8FF]'>{t('billing.plansCommon.mostPopular')}</div>
      )}
      <div className={cn(style[plan].bg, 'grow px-6 py-6 rounded-[10px]')}>
        <div className={cn(style[plan].title, 'mb-1 leading-[125%] text-lg font-semibold')}>{t(`${i18nPrefix}.name`)}</div>
        <div className={cn(isFreePlan ? 'mb-5 text-[#FB6514]' : 'mb-4 text-gray-500', 'h-8 leading-[125%] text-[13px] font-normal')}>{t(`${i18nPrefix}.description`)}</div>

        {/* Price */}
        {isFreePlan && (
          <div className={priceClassName}>{t('billing.plansCommon.free')}</div>
        )}
        {isEnterprisePlan && (
          <div className={priceClassName}>{t('billing.plansCommon.contactSales')}</div>
        )}
        {!isFreePlan && !isEnterprisePlan && (
          <div className='flex items-end h-9'>
            <div className={priceClassName}>${isYear ? planInfo.price * 10 : planInfo.price}</div>
            <div className='ml-1'>
              {isYear && <div className='leading-[18px] text-xs font-medium text-[#F26725]'>{t('billing.plansCommon.save')}${planInfo.price * 2}</div>}
              <div className='leading-[18px] text-[15px] font-normal text-gray-500'>/{t(`billing.plansCommon.${!isYear ? 'month' : 'year'}`)}</div>
            </div>
          </div>
        )}

        <div
          className={cn(isMostPopularPlan && !isCurrent && '!bg-[#444CE7] !text-white !border !border-[#3538CD] shadow-sm', isPlanDisabled ? 'opacity-30' : `${style[plan].hoverAndActive} cursor-pointer`, 'mt-4 flex h-11 items-center justify-center border-[2px] border-gray-900 rounded-3xl text-sm font-semibold text-gray-900')}
          onClick={handleGetPayUrl}
        >
          {btnText}
        </div>

        <div className='my-4 h-[1px] bg-black/5'></div>

        <div className='leading-[125%] text-[13px] font-normal text-gray-900'>
          {t(`${i18nPrefix}.includesTitle`)}
        </div>
        <KeyValue
          label={t('billing.plansCommon.messageRequest.title')}
          value={messagesRequest}
          tooltip={t('billing.plansCommon.messageRequest.tooltip') as string}
        />
        <KeyValue
          label={t('billing.plansCommon.modelProviders')}
          value={planInfo.modelProviders}
        />
        <KeyValue
          label={t('billing.plansCommon.teamMembers')}
          value={planInfo.teamMembers === NUM_INFINITE ? t('billing.plansCommon.unlimited') as string : planInfo.teamMembers}
        />
        <KeyValue
          label={t('billing.plansCommon.buildApps')}
          value={planInfo.buildApps === NUM_INFINITE ? t('billing.plansCommon.unlimited') as string : planInfo.buildApps}
        />
        <KeyValue
          label={t('billing.plansCommon.vectorSpace')}
          value={planInfo.vectorSpace === NUM_INFINITE ? t('billing.plansCommon.unlimited') as string : (planInfo.vectorSpace >= 1000 ? `${planInfo.vectorSpace / 1000}G` : `${planInfo.vectorSpace}MB`)}
          tooltip={t('billing.plansCommon.vectorSpaceBillingTooltip') as string}
        />
        <KeyValue
          label={t('billing.plansCommon.documentProcessingPriority')}
          value={t(`billing.plansCommon.priority.${planInfo.documentProcessingPriority}`) as string}
        />

        <KeyValue
          label={t('billing.plansCommon.annotatedResponse.title')}
          value={planInfo.annotatedResponse === NUM_INFINITE ? t('billing.plansCommon.unlimited') as string : `${planInfo.annotatedResponse}`}
          tooltip={t('billing.plansCommon.annotatedResponse.tooltip') as string}
        />
        <KeyValue
          label={t('billing.plansCommon.logsHistory')}
          value={planInfo.logHistory === NUM_INFINITE ? t('billing.plansCommon.unlimited') as string : `${planInfo.logHistory} ${t('billing.plansCommon.days')}`}
        />
        <KeyValue
          label={t('billing.plansCommon.customTools')}
          value={planInfo.customTools === NUM_INFINITE ? t('billing.plansCommon.unlimited') as string : (planInfo.customTools === unAvailable ? t('billing.plansCommon.unavailable') as string : `${planInfo.customTools}`)}
        />
        <KeyValue
          label={t('billing.plansCommon.support')}
          value={supportContent}
        />
      </div>
    </div>
  )
}
export default React.memo(PlanItem)
