import type { AgentLogItemWithChildren } from '@/types/workflow'
import { RiArrowLeftLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import AgentLogNavMore from './agent-log-nav-more'

type AgentLogNavProps = {
  agentOrToolLogItemStack: AgentLogItemWithChildren[]
  onShowAgentOrToolLog: (detail?: AgentLogItemWithChildren) => void
}
const AgentLogNav = ({
  agentOrToolLogItemStack,
  onShowAgentOrToolLog,
}: AgentLogNavProps) => {
  const { t } = useTranslation()
  const agentOrToolLogItemStackLength = agentOrToolLogItemStack.length
  const first = agentOrToolLogItemStack[0]
  const mid = agentOrToolLogItemStack.slice(1, -1)
  const end = agentOrToolLogItemStack.at(-1)

  return (
    <div className="flex h-8 items-center bg-components-panel-bg p-1 pr-3">
      <Button
        className="shrink-0 px-[5px]"
        size="small"
        variant="ghost-accent"
        onClick={() => {
          onShowAgentOrToolLog()
        }}
      >
        <RiArrowLeftLine className="mr-1 h-3.5 w-3.5" />
        AGENT
      </Button>
      <div className="system-xs-regular mx-0.5 shrink-0 text-divider-deep">/</div>
      {
        agentOrToolLogItemStackLength > 1
          ? (
              <Button
                className="shrink-0 px-[5px]"
                size="small"
                variant="ghost-accent"
                onClick={() => onShowAgentOrToolLog(first)}
              >
                {t('nodes.agent.strategy.label', { ns: 'workflow' })}
              </Button>
            )
          : (
              <div className="system-xs-medium-uppercase flex items-center px-[5px] text-text-tertiary">
                {t('nodes.agent.strategy.label', { ns: 'workflow' })}
              </div>
            )
      }
      {
        !!mid.length && (
          <>
            <div className="system-xs-regular mx-0.5 shrink-0 text-divider-deep">/</div>
            <AgentLogNavMore
              options={mid}
              onShowAgentOrToolLog={onShowAgentOrToolLog}
            />
          </>
        )
      }
      {
        !!end && agentOrToolLogItemStackLength > 1 && (
          <>
            <div className="system-xs-regular mx-0.5 shrink-0 text-divider-deep">/</div>
            <div className="system-xs-medium-uppercase flex items-center px-[5px] text-text-tertiary">
              {end.label}
            </div>
          </>
        )
      }
    </div>
  )
}

export default AgentLogNav
