import type { BasicPlan } from '../../../../type'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import { ALL_PLANS, NUM_INFINITE } from '../../../../config'
import { Plan } from '../../../../type'
import Item from './item'

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
    <div className="flex flex-col gap-y-2.5 p-6">
      <Item
        label={isFreePlan
          ? t('plansCommon.messageRequest.title', { ns: 'billing', count: planInfo.messageRequest })
          : t('plansCommon.messageRequest.titlePerMonth', { ns: 'billing', count: planInfo.messageRequest })}
        tooltip={t('plansCommon.messageRequest.tooltip', { ns: 'billing' }) as string}
      />
      <Item
        label={t('plansCommon.teamWorkspace', { ns: 'billing', count: planInfo.teamWorkspace })}
      />
      <Item
        label={t('plansCommon.teamMember', { ns: 'billing', count: planInfo.teamMembers })}
      />
      <Item
        label={t('plansCommon.buildApps', { ns: 'billing', count: planInfo.buildApps })}
      />
      <Divider bgStyle="gradient" />
      <Item
        label={t('plansCommon.documents', { ns: 'billing', count: planInfo.documents })}
        tooltip={t('plansCommon.documentsTooltip', { ns: 'billing' }) as string}
      />
      <Item
        label={t('plansCommon.vectorSpace', { ns: 'billing', size: planInfo.vectorSpace })}
        tooltip={t('plansCommon.vectorSpaceTooltip', { ns: 'billing' }) as string}
      />
      <Item
        label={t('plansCommon.documentsRequestQuota', { ns: 'billing', count: planInfo.documentsRequestQuota })}
        tooltip={t('plansCommon.documentsRequestQuotaTooltip', { ns: 'billing' })}
      />
      <Item
        label={[t(`plansCommon.priority.${planInfo.documentProcessingPriority}`, { ns: 'billing' }), t('plansCommon.documentProcessingPriority', { ns: 'billing' })].join('')}
      />
      <Divider bgStyle="gradient" />
      <Item
        label={
          planInfo.triggerEvents === NUM_INFINITE
            ? t('plansCommon.triggerEvents.unlimited', { ns: 'billing' })
            : plan === Plan.sandbox
              ? t('plansCommon.triggerEvents.sandbox', { ns: 'billing', count: planInfo.triggerEvents })
              : t('plansCommon.triggerEvents.professional', { ns: 'billing', count: planInfo.triggerEvents })
        }
        tooltip={t('plansCommon.triggerEvents.tooltip', { ns: 'billing' }) as string}
      />
      <Item
        label={
          plan === Plan.sandbox
            ? t('plansCommon.startNodes.limited', { ns: 'billing', count: 2 })
            : t('plansCommon.startNodes.unlimited', { ns: 'billing' })
        }
      />
      <Item
        label={
          plan === Plan.sandbox
            ? t('plansCommon.workflowExecution.standard', { ns: 'billing' })
            : plan === Plan.professional
              ? t('plansCommon.workflowExecution.faster', { ns: 'billing' })
              : t('plansCommon.workflowExecution.priority', { ns: 'billing' })
        }
        tooltip={t('plansCommon.workflowExecution.tooltip', { ns: 'billing' }) as string}
      />
      <Divider bgStyle="gradient" />
      <Item
        label={t('plansCommon.annotatedResponse.title', { ns: 'billing', count: planInfo.annotatedResponse })}
        tooltip={t('plansCommon.annotatedResponse.tooltip', { ns: 'billing' }) as string}
      />
      <Item
        label={t('plansCommon.logsHistory', { ns: 'billing', days: planInfo.logHistory === NUM_INFINITE ? t('plansCommon.unlimited', { ns: 'billing' }) as string : `${planInfo.logHistory} ${t('plansCommon.days', { ns: 'billing' })}` })}
      />
      <Item
        label={
          planInfo.apiRateLimit === NUM_INFINITE
            ? t('plansCommon.unlimitedApiRate', { ns: 'billing' })
            : `${t('plansCommon.apiRateLimitUnit', { ns: 'billing', count: planInfo.apiRateLimit })} ${t('plansCommon.apiRateLimit', { ns: 'billing' })}/${t('plansCommon.month', { ns: 'billing' })}`
        }
        tooltip={planInfo.apiRateLimit === NUM_INFINITE ? undefined : t('plansCommon.apiRateLimitTooltip', { ns: 'billing' }) as string}
      />
      <Divider bgStyle="gradient" />
      <Item
        label={t('plansCommon.modelProviders', { ns: 'billing' })}
      />
    </div>
  )
}

export default React.memo(List)
