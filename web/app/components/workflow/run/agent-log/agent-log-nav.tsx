import type { AgentLogItemWithChildren } from '@/types/workflow'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@langgenius/dify-ui/breadcrumb'
import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import AgentLogNavMore from './agent-log-nav-more'

type AgentLogNavProps = {
  agentOrToolLogItemStack: AgentLogItemWithChildren[]
  onShowAgentOrToolLog: (detail?: AgentLogItemWithChildren) => void
}
export function AgentLogNav({ agentOrToolLogItemStack, onShowAgentOrToolLog }: AgentLogNavProps) {
  const { t } = useTranslation()
  const agentOrToolLogItemStackLength = agentOrToolLogItemStack.length
  const first = agentOrToolLogItemStack[0]
  const mid = agentOrToolLogItemStack.slice(1, -1)
  const end = agentOrToolLogItemStack.at(-1)

  return (
    <Breadcrumb
      aria-label={t(($) => $['nodes.agent.strategy.label'], { ns: 'workflow' })}
      className="flex min-h-8 items-center bg-components-panel-bg p-1 pr-3"
    >
      <BreadcrumbList className="gap-0">
        <BreadcrumbItem className="shrink-0">
          <Button
            className="px-1.25"
            size="small"
            variant="ghost-accent"
            onClick={() => {
              onShowAgentOrToolLog()
            }}
          >
            <span aria-hidden className="i-ri-arrow-left-line size-3.5" />
            AGENT
          </Button>
        </BreadcrumbItem>
        <BreadcrumbSeparator className="mx-0.5 system-xs-regular text-divider-deep" />
        {agentOrToolLogItemStackLength > 1 ? (
          <BreadcrumbItem className="shrink-0">
            <Button
              className="px-1.25"
              size="small"
              variant="ghost-accent"
              onClick={() => onShowAgentOrToolLog(first)}
            >
              {t(($) => $['nodes.agent.strategy.label'], { ns: 'workflow' })}
            </Button>
          </BreadcrumbItem>
        ) : (
          <BreadcrumbItem>
            <BreadcrumbPage
              aria-current="location"
              className="px-1.25 system-xs-medium-uppercase wrap-anywhere whitespace-normal text-text-tertiary"
            >
              {t(($) => $['nodes.agent.strategy.label'], { ns: 'workflow' })}
            </BreadcrumbPage>
          </BreadcrumbItem>
        )}
        {!!mid.length && (
          <>
            <BreadcrumbSeparator className="mx-0.5 system-xs-regular text-divider-deep" />
            <BreadcrumbItem className="shrink-0">
              <AgentLogNavMore options={mid} onShowAgentOrToolLog={onShowAgentOrToolLog} />
            </BreadcrumbItem>
          </>
        )}
        {!!end && agentOrToolLogItemStackLength > 1 && (
          <>
            <BreadcrumbSeparator className="mx-0.5 system-xs-regular text-divider-deep" />
            <BreadcrumbItem>
              <BreadcrumbPage
                aria-current="location"
                className="px-1.25 system-xs-medium-uppercase wrap-anywhere whitespace-normal text-text-tertiary"
              >
                {end.label}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
