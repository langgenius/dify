import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'
import { useTranslation } from 'react-i18next'

export const SHELL_TOOL_NAMES = new Set([
  'shell_run',
  'shell_wait',
  'shell_input',
  'shell_interrupt',
])

type ToolActivityStatus =
  | 'started'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

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
}

export function ToolActivityItem({ tool }: { tool: ToolActivity }) {
  const { t } = useTranslation(['agentV2', 'tools', 'workflow'])
  const hasDetails = !!tool.input || !!tool.output || !!tool.error
  const hasStatusBadge =
    tool.status === 'failed' || tool.status === 'cancelled' || tool.status === 'interrupted'
  const statusText = hasStatusBadge
    ? tool.status === 'failed'
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
      <span className="inline-flex min-w-0 items-center gap-1">
        <span className="flex size-3.5 shrink-0 items-center justify-center text-text-tertiary">
          {!tool.isFinished ? (
            <span className="i-ri-loader-2-line size-3.5 animate-spin" aria-hidden />
          ) : tool.status === 'failed' || tool.status === 'cancelled' ? (
            <span className="i-ri-error-warning-line size-3.5 text-text-destructive" aria-hidden />
          ) : tool.status === 'interrupted' ? (
            <span className="i-ri-stop-circle-line size-3.5" aria-hidden />
          ) : tool.kind === 'shell' ? (
            <span className="i-ri-terminal-box-line size-3.5" aria-hidden />
          ) : (
            <span className="i-ri-hammer-line size-3.5" aria-hidden />
          )}
        </span>
        <span className="min-w-0 wrap-break-word text-text-secondary">{label}</span>
        {!!hasStatusBadge && statusText && (
          <span
            role="status"
            className="shrink-0 rounded-sm bg-state-base-hover px-1 py-0.5 system-xs-medium text-text-tertiary"
          >
            {statusText}
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
    <div className="flex w-full max-w-full min-w-0 flex-col items-start">
      {hasDetails ? (
        <Collapsible className="w-full max-w-full items-start">
          <CollapsibleTrigger className="group/tool flex h-6 min-h-0 max-w-full touch-manipulation items-center justify-start gap-0 rounded-md p-1 text-start system-xs-medium text-text-tertiary select-none hover:bg-state-base-hover hover:text-text-primary focus-visible:bg-state-base-hover data-panel-open:text-text-primary">
            {content}
          </CollapsibleTrigger>
          <CollapsiblePanel className="w-full max-w-full">
            <div className="w-full max-w-full min-w-0 space-y-2 pt-2 pb-2">
              {!!tool.error && (
                <div className="w-full max-w-full min-w-0 overflow-hidden rounded-[10px] bg-components-input-bg-normal px-3 py-2">
                  <div className="mt-1 max-w-full min-w-0 code-xs-regular wrap-break-word whitespace-pre-wrap text-text-destructive">
                    {tool.error}
                  </div>
                </div>
              )}
              {!!tool.input && (
                <div className="w-full max-w-full min-w-0 overflow-hidden rounded-[10px] bg-components-input-bg-normal px-3 py-2">
                  <div className="system-xs-semibold-uppercase text-text-tertiary">
                    {t(($) => $['thought.requestTitle'], { ns: 'tools' })}
                  </div>
                  <div className="mt-1 max-w-full min-w-0 code-xs-regular wrap-break-word whitespace-pre-wrap text-text-secondary">
                    {tool.input}
                  </div>
                </div>
              )}
              {!!tool.output && (
                <div className="w-full max-w-full min-w-0 overflow-hidden rounded-[10px] bg-components-input-bg-normal px-3 py-2">
                  <div className="system-xs-semibold-uppercase text-text-tertiary">
                    {t(($) => $['thought.responseTitle'], { ns: 'tools' })}
                  </div>
                  <div className="mt-1 max-w-full min-w-0 code-xs-regular wrap-break-word whitespace-pre-wrap text-text-secondary">
                    {tool.output}
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
