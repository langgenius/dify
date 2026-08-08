'use client'

import type { AgentKind } from '@dify/contracts/api/console/agent/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'

type AgentKindBadgeProps = {
  agentKind?: AgentKind | null
  className?: string
}

export function AgentKindBadge({ agentKind, className }: AgentKindBadgeProps) {
  const { t } = useTranslation('agentV2')

  if (agentKind !== 'external_agent') return null

  return (
    <span
      className={cn(
        'inline-flex h-4 shrink-0 items-center rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 system-2xs-medium-uppercase text-text-tertiary',
        className,
      )}
    >
      {t(($) => $['externalAgent.badge'])}
    </span>
  )
}
