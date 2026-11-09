import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type { TFunction } from 'i18next'
import type { PlanInfo } from '../../../../type'
import { Separator } from '@langgenius/dify-ui/separator'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { ALL_PLANS } from '../../../../config'
import { CloudPlanFeature } from './item'

type PlanFeature = {
  id: string
  label: string
  description?: string
}

function getPlanFeatureGroups(planInfo: PlanInfo, t: TFunction<['billing']>): PlanFeature[][] {
  const { messageRequest, triggerEvents, startNodes, workflowExecution, logHistory, apiRateLimit } =
    planInfo

  return [
    [
      {
        id: 'messageRequest',
        label: messageRequest.perMonth
          ? t(($) => $['plansCommon.messageRequest.titlePerMonth'], {
              count: messageRequest.count,
            })
          : t(($) => $['plansCommon.messageRequest.title'], { count: messageRequest.count }),
        description: t(($) => $['plansCommon.messageRequest.tooltip']),
      },
      { id: 'teamWorkspace', label: t(($) => $['plansCommon.teamWorkspace'], { count: 1 }) },
      {
        id: 'teamMembers',
        label: t(($) => $['plansCommon.teamMember'], { count: planInfo.teamMembers }),
      },
      {
        id: 'buildApps',
        label: t(($) => $['plansCommon.buildApps'], { count: planInfo.buildApps }),
      },
    ],
    [
      {
        id: 'documents',
        label: t(($) => $['plansCommon.documents'], { count: planInfo.documents }),
        description: t(($) => $['plansCommon.documentsTooltip']),
      },
      {
        id: 'vectorSpace',
        label: t(($) => $['plansCommon.vectorSpace'], { size: planInfo.vectorSpace }),
        description: t(($) => $['plansCommon.vectorSpaceTooltip']),
      },
      {
        id: 'documentsRequestQuota',
        label: t(($) => $['plansCommon.documentsRequestQuota'], {
          count: planInfo.documentsRequestQuota,
        }),
        description: t(($) => $['plansCommon.documentsRequestQuotaTooltip']),
      },
      {
        id: 'documentProcessingPriority',
        label: [
          t(($) => $[`plansCommon.priority.${planInfo.documentProcessingPriority}`]),
          t(($) => $['plansCommon.documentProcessingPriority']),
        ].join(''),
      },
    ],
    [
      {
        id: 'triggerEvents',
        label:
          triggerEvents === 'unlimited'
            ? t(($) => $['plansCommon.triggerEvents.unlimited'])
            : triggerEvents.perMonth
              ? t(($) => $['plansCommon.triggerEvents.professional'], {
                  count: triggerEvents.count,
                })
              : t(($) => $['plansCommon.triggerEvents.sandbox'], { count: triggerEvents.count }),
        description: t(($) => $['plansCommon.triggerEvents.tooltip']),
      },
      {
        id: 'startNodes',
        label:
          startNodes === 'unlimited'
            ? t(($) => $['plansCommon.startNodes.unlimited'])
            : t(($) => $['plansCommon.startNodes.limited'], { count: startNodes }),
      },
      {
        id: 'workflowExecution',
        label: t(($) => $[`plansCommon.workflowExecution.${workflowExecution}`]),
        description: t(($) => $['plansCommon.workflowExecution.tooltip']),
      },
    ],
    [
      {
        id: 'annotatedResponse',
        label: t(($) => $['plansCommon.annotatedResponse.title'], {
          count: planInfo.annotatedResponse,
        }),
        description: t(($) => $['plansCommon.annotatedResponse.tooltip']),
      },
      {
        id: 'logHistory',
        label: t(($) => $['plansCommon.logsHistory'], {
          days:
            logHistory === 'unlimited'
              ? t(($) => $['plansCommon.unlimited'])
              : `${logHistory} ${t(($) => $['plansCommon.days'])}`,
        }),
      },
      apiRateLimit === 'unlimited'
        ? { id: 'apiRateLimit', label: t(($) => $['plansCommon.unlimitedApiRate']) }
        : {
            id: 'apiRateLimit',
            label: `${t(($) => $['plansCommon.apiRateLimitUnit'], { count: apiRateLimit })} ${t(($) => $['plansCommon.apiRateLimit'])}/${t(($) => $['plansCommon.month'])}`,
            description: t(($) => $['plansCommon.apiRateLimitTooltip']),
          },
    ],
    [{ id: 'modelProviders', label: t(($) => $['plansCommon.modelProviders']) }],
  ]
}

export function CloudPlanFeatures({ plan }: { plan: CloudPlan }) {
  const { t } = useTranslation(['billing'])
  const featureGroups = getPlanFeatureGroups(ALL_PLANS[plan], t)

  return (
    <div className="flex flex-col gap-y-2.5 p-6">
      {featureGroups.map((features, groupIndex) => (
        <Fragment key={features[0]!.id}>
          {groupIndex > 0 && <Separator className="my-2 from-divider-accent" variant="gradient" />}
          {features.map((feature) => (
            <CloudPlanFeature
              key={feature.id}
              label={feature.label}
              description={feature.description}
            />
          ))}
        </Fragment>
      ))}
    </div>
  )
}
