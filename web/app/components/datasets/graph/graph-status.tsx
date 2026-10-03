import type { ReactNode } from 'react'
import { SpinnerIcon } from '@langgenius/dify-ui/spinner'

type GraphNoticeProps = {
  title: string
  description: string
  // Raw reason from the server or the model provider, shown verbatim.
  detail?: string | null
  action?: ReactNode
  // Work is still running; announced politely and drawn with a spinner.
  busy?: boolean
}

// Shown in place of the graph: the graph being off, building or empty, or why it failed.
export const GraphNotice = ({ title, description, detail, action, busy }: GraphNoticeProps) => (
  <div
    role={busy ? 'status' : undefined}
    className="flex h-full flex-col items-center justify-center gap-y-3 px-6"
  >
    {busy && <SpinnerIcon size="large" />}
    <div className="system-md-semibold text-text-secondary">{title}</div>
    <div className="max-w-125 text-center system-sm-regular text-text-tertiary">{description}</div>
    {!!detail && (
      <div
        role="alert"
        className="max-h-40 max-w-125 overflow-auto rounded-xl border border-state-destructive-border bg-state-destructive-hover-alt p-3 system-xs-regular break-words whitespace-pre-wrap text-text-destructive"
      >
        {detail}
      </div>
    )}
    {action}
  </div>
)

type ExtractionWarningProps = {
  summary: string
  detail?: string | null
  action?: ReactNode
}

// Shown above a graph that is still being extended by a running build.
export const BuildingBanner = ({ label }: { label: string }) => (
  <div
    role="status"
    className="flex items-center gap-2 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-3 system-sm-regular text-text-secondary"
  >
    <SpinnerIcon size="small" />
    {label}
  </div>
)

// Shown above a graph that is missing the chunks the model failed on.
export const ExtractionWarning = ({ summary, detail, action }: ExtractionWarningProps) => (
  <div
    role="alert"
    className="flex items-start gap-2 rounded-xl border border-state-warning-active bg-state-warning-hover p-3"
  >
    <span
      aria-hidden
      className="mt-0.5 i-ri-error-warning-fill size-4 shrink-0 text-text-warning"
    />
    <div className="min-w-0 grow space-y-1">
      <div className="system-sm-medium text-text-secondary">{summary}</div>
      {!!detail && <div className="system-xs-regular break-words text-text-tertiary">{detail}</div>}
    </div>
    {action}
  </div>
)
