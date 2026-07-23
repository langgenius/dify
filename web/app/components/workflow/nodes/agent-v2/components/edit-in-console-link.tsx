'use client'

import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import { getAgentDetailPath } from '@/features/agent-v2/agent-detail/routes'
import Link from '@/next/link'

const layoutClassName = 'min-w-0 flex-1 gap-1.5 px-3'

export function EditInConsoleLink({
  agentId,
  canManageAgents,
}: {
  agentId: string
  canManageAgents: boolean
}) {
  const { t } = useTranslation()
  const label = t(($) => $['nodes.agent.roster.editInConsole'], { ns: 'workflow' })

  const content = (
    <>
      <span aria-hidden className="i-ri-external-link-line size-4 shrink-0" />
      <span className="truncate">{label}</span>
    </>
  )

  if (canManageAgents) {
    return (
      <Link
        className={cn(buttonVariants({ className: layoutClassName }))}
        href={getAgentDetailPath(agentId, 'configure')}
        target="_blank"
        rel="noopener noreferrer"
      >
        {content}
      </Link>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button className={layoutClassName} disabled focusableWhenDisabled>
            {content}
          </Button>
        }
      />
      <TooltipContent>
        {t(($) => $['nodes.agent.roster.editInConsoleDisabled'], { ns: 'workflow' })}
      </TooltipContent>
    </Tooltip>
  )
}
