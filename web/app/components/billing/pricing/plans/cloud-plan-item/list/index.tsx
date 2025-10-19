import React from 'react'
import { type BasicPlan, Plan } from '../../../../type'
import Item from './item'
import { useTranslation } from 'react-i18next'
import { ALL_PLANS, NUM_INFINITE } from '../../../../config'
import Divider from '@/app/components/base/divider'

type ListProps = {
  plan: BasicPlan
}

const List = ({
  plan,
}: ListProps) => {
  const { t } = useTranslation()
  const isFreePlan = plan === Plan.sandbox
  const planInfo = ALL_PLANS[plan]

  return (
    <div className='flex flex-col gap-y-2.5 p-6'>
      <Item
        label={isFreePlan
          ? t('billing.plansCommon.messageRequest.title', { count: planInfo.messageRequest })
          : t('billing.plansCommon.messageRequest.titlePerMonth', { count: planInfo.messageRequest })}
        tooltip={t('billing.plansCommon.messageRequest.tooltip') as string}
      />
      <Item
        label={t('billing.plansCommon.teamWorkspace', { count: planInfo.teamWorkspace })}
      />
      <Item
        label={t('billing.plansCommon.teamMember', { count: planInfo.teamMembers })}
      />
      <Item
        label={t('billing.plansCommon.buildApps', { count: planInfo.buildApps })}
      />
      <Divider bgStyle='gradient' />
      <Item
        label={t('billing.plansCommon.documents', { count: planInfo.documents })}
        tooltip={t('billing.plansCommon.documentsTooltip') as string}
      />
      <Item
        label={t('billing.plansCommon.vectorSpace', { size: planInfo.vectorSpace })}
        tooltip={t('billing.plansCommon.vectorSpaceTooltip') as string}
      />
      <Item
        label={t('billing.plansCommon.documentsRequestQuota', { count: planInfo.documentsRequestQuota })}
        tooltip={t('billing.plansCommon.documentsRequestQuotaTooltip')}
      />
      <Item
        label={
          planInfo.apiRateLimit === NUM_INFINITE ? `${t('billing.plansCommon.unlimitedApiRate')}`
            : `${t('billing.plansCommon.apiRateLimitUnit', { count: planInfo.apiRateLimit })} ${t('billing.plansCommon.apiRateLimit')}`
        }
        tooltip={planInfo.apiRateLimit === NUM_INFINITE ? undefined : t('billing.plansCommon.apiRateLimitTooltip') as string}
      />
      <Item
        label={[t(`billing.plansCommon.priority.${planInfo.documentProcessingPriority}`), t('billing.plansCommon.documentProcessingPriority')].join('')}
      />
      <Divider bgStyle='gradient' />
      <Item
        label={t('billing.plansCommon.annotatedResponse.title', { count: planInfo.annotatedResponse })}
        tooltip={t('billing.plansCommon.annotatedResponse.tooltip') as string}
      />
      <Item
        label={t('billing.plansCommon.logsHistory', { days: planInfo.logHistory === NUM_INFINITE ? t('billing.plansCommon.unlimited') as string : `${planInfo.logHistory} ${t('billing.plansCommon.days')}` })}
      />
      <Divider bgStyle='gradient' />
      <Item
        label={t('billing.plansCommon.modelProviders')}
      />
    </div>
  )
}

export default React.memo(List)
