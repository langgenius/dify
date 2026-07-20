'use client'

import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import { getAgentDetailPath } from '@/features/agent-v2/agent-detail/routes'
import Link from '@/next/link'

const enabledClassName =
  'inline-flex h-8 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-3 text-[13px] leading-4 font-medium whitespace-nowrap text-components-button-secondary-text shadow-xs outline-hidden backdrop-blur-[5px] hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid'

const disabledClassName =
  'inline-flex h-8 min-w-0 flex-1 cursor-not-allowed items-center justify-center gap-1.5 rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-3 text-[13px] leading-4 font-medium whitespace-nowrap text-text-disabled shadow-xs backdrop-blur-[5px]'

export function EditInConsoleLink({
  agentId,
  canManageAgents,
}: {
  agentId: string
  canManageAgents: boolean
}) {
  const { t } = useTranslation()
  const label = t(($) => $['nodes.agent.roster.editInConsole'], { ns: 'workflow' })

  if (canManageAgents) {
    return (
      <Link
        href={getAgentDetailPath(agentId, 'configure')}
        target="_blank"
        rel="noopener noreferrer"
        className={enabledClassName}
      >
        <span aria-hidden className="i-ri-external-link-line size-4 shrink-0" />
        <span className="truncate">{label}</span>
      </Link>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span aria-disabled="true" className={disabledClassName}>
            <span aria-hidden className="i-ri-external-link-line size-4 shrink-0" />
            <span className="truncate">{label}</span>
          </span>
        }
      />
      <TooltipContent>
        {t(($) => $['nodes.agent.roster.editInConsoleDisabled'], { ns: 'workflow' })}
      </TooltipContent>
    </Tooltip>
  )
}
