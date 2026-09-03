import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import { ALL_PLANS, NUM_INFINITE } from '../../../../config'
import { CloudPlanFeature } from './item'

export function CloudPlanFeatures({ plan }: { plan: CloudPlan }) {
  const { t } = useTranslation()
  const isFreePlan = plan === 'sandbox'
  const planInfo = ALL_PLANS[plan]

  return (
    <div className="flex flex-col gap-y-2.5 p-6">
      <CloudPlanFeature
        label={
          isFreePlan
            ? t(($) => $['plansCommon.messageRequest.title'], {
                ns: 'billing',
                count: planInfo.messageRequest,
              })
            : t(($) => $['plansCommon.messageRequest.titlePerMonth'], {
                ns: 'billing',
                count: planInfo.messageRequest,
              })
        }
        description={t(($) => $['plansCommon.messageRequest.tooltip'], { ns: 'billing' }) as string}
      />
      <CloudPlanFeature
        label={t(($) => $['plansCommon.teamWorkspace'], {
          ns: 'billing',
          count: planInfo.teamWorkspace,
        })}
      />
      <CloudPlanFeature
        label={t(($) => $['plansCommon.teamMember'], {
          ns: 'billing',
          count: planInfo.teamMembers,
        })}
      />
      <CloudPlanFeature
        label={t(($) => $['plansCommon.buildApps'], { ns: 'billing', count: planInfo.buildApps })}
      />
      <Divider bgStyle="gradient" />
      <CloudPlanFeature
        label={t(($) => $['plansCommon.documents'], { ns: 'billing', count: planInfo.documents })}
        description={t(($) => $['plansCommon.documentsTooltip'], { ns: 'billing' }) as string}
      />
      <CloudPlanFeature
        label={t(($) => $['plansCommon.vectorSpace'], {
          ns: 'billing',
          size: planInfo.vectorSpace,
        })}
        description={t(($) => $['plansCommon.vectorSpaceTooltip'], { ns: 'billing' }) as string}
      />
      <CloudPlanFeature
        label={t(($) => $['plansCommon.documentsRequestQuota'], {
          ns: 'billing',
          count: planInfo.documentsRequestQuota,
        })}
        description={t(($) => $['plansCommon.documentsRequestQuotaTooltip'], { ns: 'billing' })}
      />
      <CloudPlanFeature
        label={[
          t(($) => $[`plansCommon.priority.${planInfo.documentProcessingPriority}`], {
            ns: 'billing',
          }),
          t(($) => $['plansCommon.documentProcessingPriority'], { ns: 'billing' }),
        ].join('')}
      />
      <Divider bgStyle="gradient" />
      <CloudPlanFeature
        label={
          planInfo.triggerEvents === NUM_INFINITE
            ? t(($) => $['plansCommon.triggerEvents.unlimited'], { ns: 'billing' })
            : plan === 'sandbox'
              ? t(($) => $['plansCommon.triggerEvents.sandbox'], {
                  ns: 'billing',
                  count: planInfo.triggerEvents,
                })
              : t(($) => $['plansCommon.triggerEvents.professional'], {
                  ns: 'billing',
                  count: planInfo.triggerEvents,
                })
        }
        description={t(($) => $['plansCommon.triggerEvents.tooltip'], { ns: 'billing' }) as string}
      />
      <CloudPlanFeature
        label={
          plan === 'sandbox'
            ? t(($) => $['plansCommon.startNodes.limited'], { ns: 'billing', count: 2 })
            : t(($) => $['plansCommon.startNodes.unlimited'], { ns: 'billing' })
        }
      />
      <CloudPlanFeature
        label={
          plan === 'sandbox'
            ? t(($) => $['plansCommon.workflowExecution.standard'], { ns: 'billing' })
            : plan === 'professional'
              ? t(($) => $['plansCommon.workflowExecution.faster'], { ns: 'billing' })
              : t(($) => $['plansCommon.workflowExecution.priority'], { ns: 'billing' })
        }
        description={
          t(($) => $['plansCommon.workflowExecution.tooltip'], { ns: 'billing' }) as string
        }
      />
      <Divider bgStyle="gradient" />
      <CloudPlanFeature
        label={t(($) => $['plansCommon.annotatedResponse.title'], {
          ns: 'billing',
          count: planInfo.annotatedResponse,
        })}
        description={
          t(($) => $['plansCommon.annotatedResponse.tooltip'], { ns: 'billing' }) as string
        }
      />
      <CloudPlanFeature
        label={t(($) => $['plansCommon.logsHistory'], {
          ns: 'billing',
          days:
            planInfo.logHistory === NUM_INFINITE
              ? (t(($) => $['plansCommon.unlimited'], { ns: 'billing' }) as string)
              : `${planInfo.logHistory} ${t(($) => $['plansCommon.days'], { ns: 'billing' })}`,
        })}
      />
      <CloudPlanFeature
        label={
          planInfo.apiRateLimit === NUM_INFINITE
            ? t(($) => $['plansCommon.unlimitedApiRate'], { ns: 'billing' })
            : `${t(($) => $['plansCommon.apiRateLimitUnit'], { ns: 'billing', count: planInfo.apiRateLimit })} ${t(($) => $['plansCommon.apiRateLimit'], { ns: 'billing' })}/${t(($) => $['plansCommon.month'], { ns: 'billing' })}`
        }
        description={
          planInfo.apiRateLimit === NUM_INFINITE
            ? undefined
            : (t(($) => $['plansCommon.apiRateLimitTooltip'], { ns: 'billing' }) as string)
        }
      />
      <Divider bgStyle="gradient" />
      <CloudPlanFeature label={t(($) => $['plansCommon.modelProviders'], { ns: 'billing' })} />
    </div>
  )
}
