'use client'

import type { AgentRunQueue } from './agent-run-queue'
import { useTranslation } from 'react-i18next'

/**
 * Compact readout of the live run queue: queued human inputs in arrival
 * order. Statuses only — no command text or output.
 */
export function AgentRunQueueStrip({ queue }: { queue: AgentRunQueue }) {
  const { t } = useTranslation(['agentV2'])
  const instructionLabel = t(($) => $['agentDetail.configure.preview.queue.instruction'])
  const queuedLabel = t(($) => $['agentDetail.configure.preview.queue.queued'])

  return (
    <div className="pointer-events-auto mb-2">
      {queue.entries.length > 0 && (
        <section
          aria-label={t(($) => $['agentDetail.configure.preview.queue.upNext'])}
          className="mb-2 max-h-24 overflow-auto rounded-lg border border-components-panel-border bg-background-default px-3 py-2"
        >
          <h4 className="mb-1 text-xs font-medium text-text-tertiary">
            {t(($) => $['agentDetail.configure.preview.queue.upNext'])}
          </h4>
          <ol className="space-y-1 text-xs text-text-secondary">
            {queue.entries.map((entry) => (
              <li key={entry.id} className="flex items-baseline gap-2">
                <span className="shrink-0 text-text-tertiary">{queuedLabel}</span>
                <span className="break-words">
                  {queue.textByInputId[entry.id] ?? instructionLabel}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
      {queue.sendFailed && (
        <p role="alert" className="mb-2 text-xs text-text-destructive">
          {t(($) => $['agentDetail.configure.preview.queue.sendFailed'])}
        </p>
      )}
    </div>
  )
}
