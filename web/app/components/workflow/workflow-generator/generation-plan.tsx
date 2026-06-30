'use client'
import type { BlockEnum } from '@/app/components/workflow/types'
import type { WorkflowGenPlan } from '@/service/debug'
import { RiLoader4Line } from '@remixicon/react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { SkeletonContainer, SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import BlockIcon from '@/app/components/workflow/block-icon'

type Props = Readonly<{
  /**
   * The planner result once it has streamed in, or ``null`` while the planner
   * is still running. Drives the two honest phases of the generation:
   * "Planning…" (skeleton outline) → plan outline + "Building…".
   */
  plan: WorkflowGenPlan | null
}>

// Stable keys for the planning skeleton's placeholder rows — avoids array-index
// keys while still rendering a fixed-length outline.
const SKELETON_ROWS = ['s1', 's2', 's3', 's4'] as const

// While the planner runs we render a skeleton shaped like the node list that's
// about to arrive, using the shared Skeleton primitives. The pane fills in
// place instead of jerking from a centred spinner to a left-aligned list.
const PlanningSkeleton = memo(() => {
  const { t } = useTranslation('workflow')
  return (
    <div className="flex h-full w-0 grow flex-col bg-background-default-subtle p-6">
      <SkeletonRow className="mb-3">
        <SkeletonRectangle className="size-5 rounded-md" />
        <SkeletonRectangle className="h-3 w-40" />
      </SkeletonRow>
      <div className="grow overflow-hidden rounded-2xl border border-divider-subtle bg-background-default p-4">
        <SkeletonContainer className="gap-3">
          {SKELETON_ROWS.map(key => (
            <SkeletonRow key={key} className="items-start">
              <SkeletonRectangle className="size-6 shrink-0 rounded-lg" />
              <div className="flex grow flex-col gap-1.5">
                <SkeletonRectangle className="h-3 w-1/3" />
                <SkeletonRectangle className="h-2 w-2/3" />
              </div>
            </SkeletonRow>
          ))}
        </SkeletonContainer>
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-[13px] text-text-tertiary">
        <RiLoader4Line className="size-4 animate-spin" />
        <span>{t('workflowGenerator.phases.planning')}</span>
      </div>
    </div>
  )
})
PlanningSkeleton.displayName = 'PlanningSkeleton'

/**
 * Plan-first loading view for the generator's right pane.
 *
 * Replaces the old guessed phase timer (``generation-phases``): the backend now
 * streams the real planner result, so we show a skeleton outline until it
 * arrives, then the actual node outline — rendered with the shared workflow
 * ``BlockIcon`` so each step shows the same icon the user will see on the
 * canvas — while the builder fills in the graph.
 */
const GenerationPlan = ({ plan }: Props) => {
  const { t } = useTranslation('workflow')

  if (!plan)
    return <PlanningSkeleton />

  return (
    <div className="flex h-full w-0 grow flex-col bg-background-default-subtle p-6">
      {(plan.icon || plan.app_name || plan.title) && (
        <div className="mb-3 flex items-center gap-2">
          {plan.icon && <span className="text-xl leading-none">{plan.icon}</span>}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-text-primary">{plan.app_name || plan.title}</div>
            {plan.description && <div className="truncate system-xs-regular text-text-tertiary">{plan.description}</div>}
          </div>
        </div>
      )}

      <div className="grow overflow-y-auto rounded-2xl border border-divider-subtle bg-background-default p-4">
        <ol className="space-y-2.5">
          {plan.nodes.map((node, index) => (
            <li key={`${node.label}-${index}`} className="flex items-start gap-2.5">
              <BlockIcon type={node.node_type as BlockEnum} size="md" className="mt-px shrink-0" />
              <div className="min-w-0">
                <div className="system-sm-medium text-text-secondary">
                  {node.label}
                  <span className="ml-1 system-xs-regular text-text-quaternary">
                    ·
                    {node.node_type}
                  </span>
                </div>
                {node.purpose && <div className="system-xs-regular text-text-tertiary">{node.purpose}</div>}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-[13px] text-text-tertiary">
        <RiLoader4Line className="size-4 animate-spin" />
        <span>{t('workflowGenerator.phases.building')}</span>
      </div>
    </div>
  )
}

export default memo(GenerationPlan)
