import type {
  AgentToolActivity,
  ToolCallLimitMetadata,
} from '@dify/contracts/api/console/agent/types.gen'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'
import { useTranslation } from 'react-i18next'
import styles from './tool-activity-item.module.css'

export const SHELL_TOOL_NAMES = new Set([
  'shell_run',
  'shell_wait',
  'shell_input',
  'shell_interrupt',
])

type ToolActivityStatus = AgentToolActivity['status'] | 'interrupted'

export type ToolActivity = {
  kind: 'shell' | 'tool'
  key: string
  name: string
  label: string
  input: string
  output: string
  isFinished: boolean
  status?: ToolActivityStatus
  error?: string | null
  callLimit?: ToolCallLimitMetadata | null
}

export function ToolActivityItem({ tool }: { tool: ToolActivity }) {
  const { t } = useTranslation(['agentV2', 'tools', 'workflow', 'common'])
  const blocked = tool.status === 'not_executed'
  const limitRejection =
    blocked && tool.callLimit?.reason === 'call_limit_reached' ? tool.callLimit : null
  const error = limitRejection
    ? t(($) => $['toolCallLimit.reached'], { limit: limitRejection.limit, ns: 'agentV2' })
    : tool.error
  const output = blocked ? '' : tool.output
  const hasDetails = !!tool.input || !!output || !!error
  const hasStatusBadge =
    blocked ||
    tool.status === 'failed' ||
    tool.status === 'cancelled' ||
    tool.status === 'interrupted'
  const statusText = hasStatusBadge
    ? blocked
      ? t(($) => $['toolCallLimit.notExecuted'], { ns: 'agentV2' })
      : tool.status === 'failed'
        ? t(($) => $['tracing.status.failed'], { ns: 'workflow' })
        : t(($) => $['tracing.status.stopped'], { ns: 'workflow' })
    : ''
  const resolvedPhase =
    tool.status ?? (tool.isFinished ? ('succeeded' as const) : ('running' as const))
  const label =
    tool.name === 'shell_run' &&
    tool.label === tool.name &&
    (resolvedPhase === 'started' || resolvedPhase === 'running' || resolvedPhase === 'succeeded')
      ? resolvedPhase === 'started'
        ? t(($) => $['agentDetail.configure.answer.activity.startingCommands'], {
            ns: 'agentV2',
          })
        : resolvedPhase === 'running'
          ? t(($) => $['agentDetail.configure.answer.activity.runningCommands'], {
              ns: 'agentV2',
            })
          : t(($) => $['agentDetail.configure.answer.activity.ranCommands'], { ns: 'agentV2' })
      : tool.label

  const content = (
    <>
      <span className="inline-flex min-w-0 items-center gap-2">
        <span className="inline-flex min-w-0 items-center gap-1">
          <span className="flex size-3.5 shrink-0 items-center justify-center text-text-tertiary">
            {!tool.isFinished ? (
              <span className="i-ri-loader-2-line size-3.5 animate-spin" aria-hidden />
            ) : tool.status === 'failed' || tool.status === 'cancelled' ? (
              <span
                className="i-ri-error-warning-line size-3.5 text-text-destructive"
                aria-hidden
              />
            ) : tool.status === 'interrupted' ? (
              <span className="i-ri-stop-circle-line size-3.5" aria-hidden />
            ) : tool.kind === 'shell' ? (
              <span className="i-ri-terminal-box-line size-3.5" aria-hidden />
            ) : (
              <span className="i-ri-hammer-line size-3.5" aria-hidden />
            )}
          </span>
          <span className="min-w-0 truncate text-text-tertiary">{label}</span>
        </span>
        {!!hasStatusBadge && statusText && (
          <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap">
            <span
              role="status"
              className={
                blocked
                  ? 'shrink-0 system-xs-regular text-text-warning'
                  : 'shrink-0 rounded-sm bg-state-base-hover px-1 py-0.5 system-xs-medium text-text-tertiary'
              }
            >
              {statusText}
            </span>
            {limitRejection && (
              <span
                className={`shrink-0 system-xs-regular whitespace-nowrap text-text-tertiary ${styles.quota}`}
              >
                {t(($) => $['toolCallLimit.used'], {
                  count: limitRejection.limit,
                  used: limitRejection.used,
                  limit: limitRejection.limit,
                  ns: 'agentV2',
                })}
              </span>
            )}
          </span>
        )}
      </span>
      {hasDetails && (
        <span
          className="i-ri-arrow-right-s-line size-4 shrink-0 text-text-tertiary transition-transform duration-100 ease-out group-data-panel-open/tool:rotate-90 motion-reduce:transition-none"
          aria-hidden
        />
      )}
    </>
  )

  return (
    <div className={`flex w-full max-w-full min-w-0 flex-col items-start ${styles.activity}`}>
      {hasDetails ? (
        <Collapsible className="w-full max-w-full items-start">
          <CollapsibleTrigger className="group/tool flex h-6 min-h-0 max-w-full min-w-0 touch-manipulation items-center justify-start gap-0 rounded-md p-1 text-start system-xs-medium text-text-tertiary select-none hover:bg-state-base-hover hover:text-text-primary focus-visible:bg-state-base-hover data-panel-open:text-text-primary">
            {content}
          </CollapsibleTrigger>
          <CollapsiblePanel className="w-full max-w-full">
            <div className="ms-2.75 flex min-w-0 flex-col gap-2 border-s-[1.5px] border-divider-regular ps-2.75 pt-0.5 pb-1.5">
              {!!tool.input && (
                <div className="flex w-full min-w-0 flex-col gap-0.5">
                  <div className="system-2xs-medium-uppercase text-text-tertiary">
                    {t(($) => $['thought.requestTitle'], { ns: 'tools' })}
                  </div>
                  <div
                    className={`max-w-full min-w-0 code-xs-regular wrap-break-word whitespace-pre-wrap text-text-secondary ${styles.code}`}
                  >
                    {tool.input}
                  </div>
                </div>
              )}
              {!!error && (
                <div className="flex w-full min-w-0 flex-col gap-0.5">
                  {(blocked || tool.status === 'failed') && (
                    <div className="system-2xs-medium-uppercase text-text-tertiary">
                      {blocked
                        ? t(($) => $['toolCallLimit.reason'], { ns: 'agentV2' })
                        : t(($) => $.error, { ns: 'common' })}
                    </div>
                  )}
                  <div className="max-w-full min-w-0 body-sm-regular tracking-[-0.005em] wrap-break-word whitespace-pre-wrap text-text-secondary">
                    {error}
                  </div>
                </div>
              )}
              {!!output && (
                <div className="flex w-full min-w-0 flex-col gap-0.5">
                  <div className="system-2xs-medium-uppercase text-text-tertiary">
                    {t(($) => $['thought.responseTitle'], { ns: 'tools' })}
                  </div>
                  <div
                    className={`max-w-full min-w-0 code-xs-regular wrap-break-word whitespace-pre-wrap text-text-secondary ${styles.code}`}
                  >
                    {output}
                  </div>
                </div>
              )}
            </div>
          </CollapsiblePanel>
        </Collapsible>
      ) : (
        <div className="inline-flex h-6 w-auto max-w-full items-center rounded-md p-1 system-xs-medium">
          {content}
        </div>
      )}
    </div>
  )
}
