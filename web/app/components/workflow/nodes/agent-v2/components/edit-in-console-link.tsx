import { buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { getAgentDetailPath } from '@/features/agent-v2/agent-detail/routes'
import Link from '@/next/link'

const layoutClassName = 'min-w-0 flex-1 px-3'

export function EditInConsoleLink({ agentId }: { agentId: string }) {
  const { t } = useTranslation()
  const label = t(($) => $['nodes.agent.roster.editInConsole'], { ns: 'workflow' })

  return (
    <Link
      className={cn(buttonVariants(), layoutClassName)}
      href={getAgentDetailPath(agentId, 'configure')}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span aria-hidden className="i-ri-external-link-line size-4 shrink-0" />
      <span className="truncate" title={label}>
        {label}
      </span>
    </Link>
  )
}
