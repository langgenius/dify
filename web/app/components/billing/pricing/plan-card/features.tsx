import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type { ReactNode } from 'react'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ALL_PLANS } from '../../config'

type PlanFeatureExplanation = {
  labelId: string
  description: string
}

export function PlanFeatureInfotip({ children }: { children: ReactNode }) {
  // Pinning belongs to the pressed feature. Hovering another feature must start a dismissible preview.
  const [active, setActive] = useState<{ id: string; mode: 'hover' | 'pinned' } | null>(null)
  return (
    <Infotip<PlanFeatureExplanation>
      open={active !== null}
      triggerId={active?.id ?? null}
      onOpenChange={(open, details) => {
        const id = details.trigger?.id
        if (details.reason === 'trigger-press' && id) {
          if (active?.mode === 'pinned' && active.id === id) {
            setActive(null)
          } else {
            // Let hover keep its native leave behavior after this pin is replaced.
            details.cancel()
            setActive({ id, mode: 'pinned' })
          }
          return
        }
        if (details.reason === 'trigger-hover') {
          if (active?.mode === 'pinned' && (!open || id === active.id)) {
            details.cancel()
            return
          }
          if (open && id) {
            setActive({ id, mode: 'hover' })
            return
          }
        }
        if (!open) setActive(null)
      }}
    >
      {({ payload }) => (
        <>
          {children}
          <InfotipContent
            aria-labelledby={payload?.labelId}
            className="max-w-80 whitespace-pre-wrap"
          >
            {payload?.description}
          </InfotipContent>
        </>
      )}
    </Infotip>
  )
}

function CloudPlanFeature({ label, description }: { label: string; description?: string }) {
  const labelId = useId()

  return (
    <li className="flex min-h-5 items-center gap-1.5 border-b border-(--pricing-feature-border) pb-0.5 text-sm leading-[17px]">
      <span
        aria-hidden
        className="h-[7px] w-1 flex-none pt-[3px] after:block after:size-1 after:rounded-full after:bg-text-accent"
      />
      <span id={labelId} className="min-w-0 flex-1 wrap-anywhere">
        {label}
      </span>
      {description && (
        <InfotipTrigger<PlanFeatureExplanation>
          aria-labelledby={labelId}
          payload={{ labelId, description }}
          iconVariant="information"
          size="lg"
          className="-m-0.75 text-(--pricing-info)"
        />
      )}
    </li>
  )
}

export function CloudPlanFeatures({ plan }: { plan: CloudPlan }) {
  const { t } = useTranslation(['billing'])
  const info = ALL_PLANS[plan]
  const paid = plan !== 'sandbox'
  const [, amount = info.vectorSpace, unit = ''] = info.vectorSpace.match(/^(\d+)(MB|GB)$/) ?? []
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
      label: info.messageRequest.perMonth
        ? t(($) => $['pricing.credits.monthly'], { count: info.messageRequest.count })
        : t(($) => $['pricing.credits.total'], { count: info.messageRequest.count }),
      description: paid
        ? t(($) => $['pricing.credits.advanced'])
        : t(($) => $['pricing.credits.basic']),
    },
    { id: 'members', label: t(($) => $['pricing.members'], { count: info.teamMembers }) },
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
        ? t(($) => $['pricing.logs.paid'])
        : t(($) => $['pricing.logs.limited'], { count: 30 }),
      description: paid
        ? t(($) => $['pricing.logs.paidNote'])
        : t(($) => $['pricing.logs.sandboxNote']),
    },
    { id: 'documents', label: t(($) => $['pricing.documents'], { count: info.documents }) },
    {
      id: 'storage',
      label: t(($) => $['pricing.storage.label'], { amount, unit }),
      description: t(($) => $['pricing.storage.tooltip']),
    },
    {
      id: 'requests',
      label: t(($) => $['pricing.requests'], { count: info.documentsRequestQuota }),
    },
    {
      id: 'processing',
      label: t(($) => $[`pricing.processing.${plan}`]),
      description: t(($) => $[`pricing.processing.${plan}Tooltip`]),
    },
    {
      id: 'triggers',
      label:
        info.triggerEvents === 'unlimited'
          ? t(($) => $['pricing.triggers.unlimited'])
          : info.triggerEvents.perMonth
            ? t(($) => $['pricing.triggers.monthly'], { count: info.triggerEvents.count })
            : t(($) => $['pricing.triggers.total'], { count: info.triggerEvents.count }),
      description: t(($) => $[`pricing.triggers.${plan}Tooltip`]),
    },
    { id: 'execution', label: t(($) => $[`pricing.execution.${plan}`]) },
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
    <ul className="mt-8 flex flex-col gap-2.5">
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
