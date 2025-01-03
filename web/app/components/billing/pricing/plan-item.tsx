'use client'
import type { FC, ReactNode } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { RiApps2Line, RiBook2Line, RiBrain2Line, RiChatAiLine, RiFileEditLine, RiFolder6Line, RiGroupLine, RiHardDrive3Line, RiHistoryLine, RiProgress3Line, RiQuestionLine, RiSeoLine } from '@remixicon/react'
import { Plan } from '../type'
import { ALL_PLANS, NUM_INFINITE, contactSalesUrl } from '../config'
import Toast from '../../base/toast'
import Tooltip from '../../base/tooltip'
import Divider from '../../base/divider'
import { ArCube1, Group2, Keyframe, SparklesSoft } from '../../base/icons/src/public/billing'
import { PlanRange } from './select-plan-range'
import cn from '@/utils/classnames'
import { useAppContext } from '@/context/app-context'
import { fetchSubscriptionUrls } from '@/service/billing'

type Props = {
  currentPlan: Plan
  plan: Plan
  planRange: PlanRange
  canPay: boolean
}

const KeyValue = ({ icon, label, tooltip }: { icon: ReactNode; label: string; tooltip?: string }) => {
  return (
    <div className='flex text-text-tertiary'>
      <div className='size-4 flex items-center justify-center'>
        {icon}
      </div>
      <div className='ml-2 mr-0.5 text-text-primary system-sm-regular'>{label}</div>
      {tooltip && (
        <Tooltip
          asChild
          popupContent={tooltip}
          popupClassName='w-[200px]'
        >
          <div className='size-4 flex items-center justify-center'>
            <RiQuestionLine className='text-text-secondary' />
          </div>
        </Tooltip>
      )}
    </div>
  )
}

const priceClassName = 'leading-[125%] text-[28px] font-bold text-text-primary'
const style = {
  [Plan.sandbox]: {
    icon: <ArCube1 className='text-text-primary size-7' />,
    description: 'text-util-colors-gray-gray-600',
    btnStyle: 'bg-components-button-secondary-bg hover:bg-components-button-secondary-bg-hover border-[0.5px] border-components-button-secondary-border text-text-primary',
  },
  [Plan.professional]: {
    icon: <Keyframe className='text-util-colors-blue-brand-blue-brand-600 size-7' />,
    description: 'text-util-colors-blue-brand-blue-brand-600',
    btnStyle: 'bg-components-button-primary-bg hover:bg-components-button-primary-bg-hover border border-component-button-primary-border text-components-button-primary-text',
  },
  [Plan.team]: {
    icon: <Group2 className='text-util-colors-indigo-indigo-600 size-7' />,
    description: 'text-util-colors-indigo-indigo-600',
    btnStyle: 'bg-components-button-indigo-bg hover:bg-components-button-indigo-bg-hover border border-components-button-primary-border text-components-button-primary-text',
  },
  [Plan.enterprise]: {
    icon: 'text-[#DC6803]',
    description: '',
    btnStyle: 'hover:shadow-lg hover:!text-white hover:!bg-[#F79009] hover:!border-[#DC6803] active:!text-white active:!bg-[#DC6803] active:!border-[#DC6803]',
  },
}
const PlanItem: FC<Props> = ({
  plan,
  currentPlan,
  planRange,
  canPay,
}) => {
  const { t } = useTranslation()
  // const { locale } = useContext(I18n)

  // const isZh = locale === LanguagesSupported[1]
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
  // const messagesRequest = (() => {
  //   const value = planInfo.messageRequest[isZh ? 'zh' : 'en']
  //   if (value === contractSales)
  //     return t('billing.plansCommon.contractSales')

  //   return value
  // })()
  const btnText = (() => {
    if (!canPay && plan !== Plan.enterprise)
      return t('billing.plansCommon.contractOwner')

    if (isCurrent)
      return t('billing.plansCommon.currentPlan')

    return ({
      [Plan.sandbox]: t('billing.plansCommon.startForFree'),
      [Plan.professional]: t('billing.plansCommon.getStarted'),
      [Plan.team]: t('billing.plansCommon.getStarted'),
      [Plan.enterprise]: t('billing.plansCommon.talkToSales'),
    })[plan]
  })()
  // const comingSoon = (
  //   <div className='leading-[12px] text-[9px] font-semibold text-[#3538CD] uppercase'>{t('billing.plansCommon.comingSoon')}</div>
  // )
  // const supportContent = (() => {
  //   switch (plan) {
  //     case Plan.sandbox:
  //       return (<div className='space-y-3.5'>
  //         <div>{t('billing.plansCommon.supportItems.communityForums')}</div>
  //         <div>{t('billing.plansCommon.supportItems.agentMode')}</div>
  //         <div className='flex items-center space-x-1'>
  //           <div className='flex items-center'>
  //             <div className='mr-0.5'>&nbsp;{t('billing.plansCommon.supportItems.workflow')}</div>
  //           </div>
  //         </div>
  //       </div>)
  //     case Plan.professional:
  //       return (
  //         <div>
  //           <div>{t('billing.plansCommon.supportItems.emailSupport')}</div>
  //           <div className='mt-3.5 flex items-center space-x-1'>
  //             <div>+ {t('billing.plansCommon.supportItems.logoChange')}</div>
  //           </div>
  //           <div className='mt-3.5 flex items-center space-x-1'>
  //             <div>+ {t('billing.plansCommon.supportItems.bulkUpload')}</div>
  //           </div>
  //           <div className='mt-3.5 flex items-center space-x-1'>
  //             <span>+ </span>
  //             <div>{t('billing.plansCommon.supportItems.llmLoadingBalancing')}</div>
  //             <Tooltip
  //               popupContent={
  //                 <div className='w-[200px]'>{t('billing.plansCommon.supportItems.llmLoadingBalancingTooltip')}</div>
  //               }
  //             />
  //           </div>
  //           <div className='mt-3.5 flex items-center space-x-1'>
  //             <div className='flex items-center'>
  //               +
  //               <div className='mr-0.5'>&nbsp;{t('billing.plansCommon.supportItems.ragAPIRequest')}</div>
  //               <Tooltip
  //                 popupContent={
  //                   <div className='w-[200px]'>{t('billing.plansCommon.ragAPIRequestTooltip')}</div>
  //                 }
  //               />
  //             </div>
  //             <div>{comingSoon}</div>
  //           </div>
  //         </div>
  //       )
  //     case Plan.team:
  //       return (
  //         <div>
  //           <div>{t('billing.plansCommon.supportItems.priorityEmail')}</div>
  //           <div className='mt-3.5 flex items-center space-x-1'>
  //             <div>+ {t('billing.plansCommon.supportItems.SSOAuthentication')}</div>
  //             <div>{comingSoon}</div>
  //           </div>
  //         </div>
  //       )
  //     case Plan.enterprise:
  //       return (
  //         <div>
  //           <div>{t('billing.plansCommon.supportItems.personalizedSupport')}</div>
  //           <div className='mt-3.5 flex items-center space-x-1'>
  //             <div>+ {t('billing.plansCommon.supportItems.dedicatedAPISupport')}</div>
  //           </div>
  //           <div className='mt-3.5 flex items-center space-x-1'>
  //             <div>+ {t('billing.plansCommon.supportItems.customIntegration')}</div>
  //           </div>
  //         </div>
  //       )
  //     default:
  //       return ''
  //   }
  // })()
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
    <div className={cn('flex flex-col w-[373px] p-6 border-[0.5px] border-effects-highlight-lightmode-off bg-background-section-burn rounded-2xl',
      isMostPopularPlan ? 'shadow-lg backdrop-blur-[5px] border-effects-highlight' : 'hover:shadow-lg hover:backdrop-blur-[5px] hover:border-effects-highlight',
    )}>
      <div className='flex flex-col gap-y-1'>
        {style[plan].icon}
        <div className='flex items-center'>
          <div className='leading-[125%] text-lg font-semibold uppercase text-text-primary'>{t(`${i18nPrefix}.name`)}</div>
          {isMostPopularPlan && <div className='ml-1 px-1 py-[3px] flex items-center justify-center rounded-full border-[0.5px] shadow-xs bg-price-premium-badge-background text-components-premium-badge-grey-text-stop-0'>
            <div className='pl-0.5'>
              <SparklesSoft className='size-3' />
            </div>
            <span className='px-0.5 system-2xs-semibold-uppercase bg-clip-text bg-price-premium-text-background text-transparent'>Popular</span>
          </div>}
        </div>
        <div className={cn(style[plan].description, 'system-sm-regular')}>{t(`${i18nPrefix}.description`)}</div>
      </div>
      <div className='my-5'>
        {/* Price */}
        {isFreePlan && (
          <div className={priceClassName}>{t('billing.plansCommon.free')}</div>
        )}
        {isEnterprisePlan && (
          <div className={priceClassName}>{t('billing.plansCommon.contactSales')}</div>
        )}
        {!isFreePlan && !isEnterprisePlan && (
          <div className='flex items-end'>
            <div className={priceClassName}>${isYear ? planInfo.price * 10 : planInfo.price}</div>
            <div className='ml-1 flex flex-col'>
              {isYear && <div className='leading-[14px] text-[14px] font-normal italic text-text-warning'>{t('billing.plansCommon.save')}${planInfo.price * 2}</div>}
              <div className='leading-normal text-[14px] font-normal text-text-tertiary'>
                {t('billing.plansCommon.priceTip')}
                {t(`billing.plansCommon.${!isYear ? 'month' : 'year'}`)}</div>
            </div>
          </div>
        )}
      </div>

      <div
        className={cn('flex py-3 px-5 rounded-full justify-center items-center h-[42px]',
          style[plan].btnStyle,
          isPlanDisabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer ')}
        onClick={handleGetPayUrl}
      >
        {btnText}
      </div>
      <div className='flex flex-col gap-y-3 mt-6'>
        <KeyValue
          icon={<RiChatAiLine />}
          label={isFreePlan
            ? t('billing.plansCommon.messageRequest.title', { count: planInfo.messageRequest })
            : t('billing.plansCommon.messageRequest.titlePerMonth', { count: planInfo.messageRequest })}
          tooltip={t('billing.plansCommon.messageRequest.tooltip') as string}
        />
        <KeyValue
          icon={<RiBrain2Line />}
          label={t('billing.plansCommon.modelProviders')}
        />
        <KeyValue
          icon={<RiFolder6Line />}
          label={t('billing.plansCommon.teamWorkspace', { count: planInfo.teamWorkspace })}
        />
        <KeyValue
          icon={<RiGroupLine />}
          label={t('billing.plansCommon.teamMember', { count: planInfo.teamMembers })}
        />
        <KeyValue
          icon={<RiApps2Line />}
          label={t('billing.plansCommon.buildApps', { count: planInfo.buildApps })}
        />
        <Divider bgStyle='gradient' />
        <KeyValue
          icon={<RiBook2Line />}
          label={t('billing.plansCommon.documents', { count: planInfo.documents })}
          tooltip={t('billing.plansCommon.documentsTooltip') as string}
        />
        <KeyValue
          icon={<RiHardDrive3Line />}
          label={t('billing.plansCommon.vectorSpace', { size: planInfo.vectorSpace })}
          tooltip={t('billing.plansCommon.vectorSpaceTooltip') as string}
        />

        <KeyValue
          icon={<RiSeoLine />}
          label={t('billing.plansCommon.documentsRequestQuota', { count: planInfo.documentsRequestQuota })}
          tooltip={t('billing.plansCommon.documentsRequestQuotaTooltip') as string}
        />
        <KeyValue
          icon={<RiProgress3Line />}
          label={[t(`billing.plansCommon.priority.${planInfo.documentProcessingPriority}`), t('billing.plansCommon.documentProcessingPriority')].join(' ')}
        />
        <Divider bgStyle='gradient' />
        <KeyValue
          icon={<RiFileEditLine />}
          label={t('billing.plansCommon.annotatedResponse.title', { count: planInfo.annotatedResponse })}
          tooltip={t('billing.plansCommon.annotatedResponse.tooltip') as string}
        />
        <KeyValue
          icon={<RiHistoryLine />}
          label={t('billing.plansCommon.logsHistory', { days: planInfo.logHistory === NUM_INFINITE ? t('billing.plansCommon.unlimited') as string : `${planInfo.logHistory} ${t('billing.plansCommon.days')}` })}
        />
      </div>
    </div>
  )
}
export default React.memo(PlanItem)
