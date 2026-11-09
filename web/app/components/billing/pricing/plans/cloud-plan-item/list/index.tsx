import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import { useTranslation } from 'react-i18next'
import { ALL_PLANS } from '../../../../config'
import styles from '../../../pricing.module.css'
import { CloudPlanFeature } from './item'

export function CloudPlanFeatures({ plan }: { plan: CloudPlan }) {
  const { t } = useTranslation(['billing'])
  const info = ALL_PLANS[plan]
  const paid = plan !== 'sandbox'
  const modelScope = paid
    ? t(($) => $['pricing.credits.advanced'])
    : t(($) => $['pricing.credits.basic'])
  const logNote = paid
    ? t(($) => $['pricing.logs.paidNote'])
    : t(($) => $['pricing.logs.sandboxNote'])
  const features = [
    {
      id: 'runs',
      label: paid
        ? t(($) => $['pricing.runs.unlimited'])
        : t(($) => $['pricing.runs.limited'], { count: 500 }),
      description: paid ? undefined : t(($) => $['pricing.runs.tooltip']),
    },
    {
      id: 'credits',
      label: paid
        ? t(($) => $['pricing.credits.monthly'], { count: info.messageRequest.count })
        : t(($) => $['pricing.credits.total'], { count: info.messageRequest.count }),
      description: modelScope,
    },
    ...(paid
      ? [{ id: 'models', label: t(($) => $['pricing.advancedModels']), description: modelScope }]
      : []),
    { id: 'members', label: t(($) => $['plansCommon.teamMember'], { count: info.teamMembers }) },
    ...(paid
      ? [
          {
            id: 'collaboration',
            label: t(($) => $['pricing.collaboration.label']),
            description: t(($) => $['pricing.collaboration.tooltip']),
          },
        ]
      : []),
    { id: 'apps', label: t(($) => $['pricing.apps'], { count: info.buildApps }) },
    ...(paid
      ? [
          { id: 'versions', label: t(($) => $['pricing.versions']) },
          {
            id: 'branding',
            label: t(($) => $['pricing.branding.label']),
            description: t(($) => $['pricing.branding.tooltip']),
          },
        ]
      : []),
    {
      id: 'logs',
      label: paid
        ? t(($) => $['pricing.logs.unlimited'])
        : t(($) => $['pricing.logs.limited'], { count: 30 }),
      description: logNote,
    },
    {
      id: 'documents',
      label: t(($) => $['plansCommon.documents'], { count: info.documents }),
    },
    {
      id: 'storage',
      label: t(($) => $['plansCommon.vectorSpace'], {
        size: info.vectorSpace.replace(/(MB|GB)$/, ' $1'),
      }),
    },
    {
      id: 'requests',
      label: t(($) => $['plansCommon.documentsRequestQuota'], {
        count: info.documentsRequestQuota,
      }),
    },
    {
      id: 'processing',
      label:
        t(($) => $[`plansCommon.priority.${info.documentProcessingPriority}`]) +
        t(($) => $['plansCommon.documentProcessingPriority']),
      description: t(($) => $[`pricing.processing.${plan}Tooltip`]),
    },
    {
      id: 'triggers',
      label:
        info.triggerEvents === 'unlimited'
          ? t(($) => $['plansCommon.triggerEvents.unlimited'])
          : plan === 'professional'
            ? t(($) => $['plansCommon.triggerEvents.professional'], {
                count: info.triggerEvents.count,
              })
            : t(($) => $['pricing.triggers.total'], {
                count: info.triggerEvents.count,
              }),
      description: t(($) => $[`pricing.triggers.${plan}Tooltip`]),
    },
    {
      id: 'execution',
      label: t(($) => $[`plansCommon.workflowExecution.${info.workflowExecution}`]),
    },
    ...(paid
      ? [
          {
            id: 'balancing',
            label: t(($) => $['pricing.balancing.label']),
            description: t(($) => $['pricing.balancing.tooltip']),
          },
        ]
      : []),
    { id: 'support', label: t(($) => $[`pricing.support.${plan}`]) },
    ...(paid
      ? [
          {
            id: 'compliance',
            label: t(($) => $[`pricing.compliance.${plan}`]),
            description: t(($) => $[`pricing.compliance.${plan}Files`]),
          },
        ]
      : []),
  ]

  return (
    <ul className={styles.features}>
      {features.map((feature) => (
        <CloudPlanFeature
          key={feature.id}
          label={feature.label}
          description={feature.description}
        />
      ))}
    </ul>
  )
}
