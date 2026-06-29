'use client'
import type { WorkflowGenPlan } from '@/service/debug'
import { RiLoader4Line } from '@remixicon/react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'

type Props = Readonly<{
  /**
   * The planner result once it has streamed in, or ``null`` while the planner
   * is still running. Drives the two honest phases of the generation:
   * "Planning…" (spinner) → plan outline + "Building…".
   */
  plan: WorkflowGenPlan | null
}>

/**
 * Plan-first loading view for the generator's right pane.
 *
 * Replaces the old guessed phase timer (``generation-phases``): the backend now
 * streams the real planner result, so we show "Planning…" until it arrives,
 * then the actual node outline while the builder fills in the graph. Real
 * progress the user can read instead of a spinner they can only wait on.
 */
const GenerationPlan = ({ plan }: Props) => {
  const { t } = useTranslation('workflow')

  if (!plan) {
    return (
      <div className="flex h-full w-0 grow flex-col items-center justify-center space-y-3">
        <Loading />
        <div className="text-[13px] text-text-tertiary">{t('workflowGenerator.phases.planning')}</div>
      </div>
    )
  }

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
            <li key={`${node.label}-${index}`} className="flex items-start gap-2">
              <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded bg-components-button-secondary-bg text-[11px] font-medium text-text-tertiary">
                {index + 1}
              </span>
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
