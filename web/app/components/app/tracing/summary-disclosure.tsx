import type { ReactNode } from 'react'
import { CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'

/** One-line disclosure for secondary tracing details, optionally with its state on the right. */
export function SummaryDisclosureTrigger({
  label,
  summary,
}: {
  label: ReactNode
  summary?: ReactNode
}) {
  return (
    <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md py-0.5 text-left system-xs-medium text-text-tertiary hover:text-text-secondary">
      <span className="min-w-0 flex-1">{label}</span>
      {summary && <span className="shrink-0 system-xs-regular">{summary}</span>}
      <span
        aria-hidden
        className="i-ri-arrow-down-s-line size-4 shrink-0 transition-transform group-data-panel-open:rotate-180 motion-reduce:transition-none"
      />
    </CollapsibleTrigger>
  )
}
