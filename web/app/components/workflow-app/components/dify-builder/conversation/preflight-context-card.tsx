import type { PreflightContextCard as PreflightContextCardData } from '@dify/contracts/api/console/dify-builder/types.gen'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { DifyBuilderCard } from '../cards/card-shell'

export const PreflightContextCard = memo(
  ({ payload, invalidated }: { payload: PreflightContextCardData; invalidated: boolean }) => {
    const { t } = useTranslation()

    return (
      <DifyBuilderCard
        category={t(($) => $['difyBuilder.cardCategory.checks'], { ns: 'workflow' })}
        headline={t(($) => $['difyBuilder.checklistIssues'], { ns: 'workflow' })}
        invalidated={invalidated}
        meta={String(payload.issue_count)}
        status={payload.issue_count > 0 ? { state: 'blocked' } : undefined}
      >
        {payload.issues?.length ? (
          <ul className="flex flex-col gap-2">
            {payload.issues.map((issue) => {
              const occurrences = new Map<string, number>()
              const messages = (issue.messages ?? []).map((text) => {
                const occurrence = (occurrences.get(text) ?? 0) + 1
                occurrences.set(text, occurrence)
                return { key: `message-${text}-${occurrence}`, text }
              })
              if (issue.unconnected)
                messages.push({
                  key: 'unconnected',
                  text: t(($) => $['common.needConnectTip'], { ns: 'workflow' }),
                })
              if (issue.plugin_missing)
                messages.push({
                  key: 'plugin-missing',
                  text: t(($) => $['nodes.common.pluginsNotInstalled'], {
                    ns: 'workflow',
                    count: 1,
                  }),
                })

              return (
                <li
                  key={`${issue.node_id}-${issue.title}`}
                  className="overflow-hidden rounded-lg bg-background-section"
                >
                  <div className="flex min-w-0 items-center gap-2 px-3 pt-2.5 pb-1.5">
                    <span
                      aria-hidden="true"
                      className="i-ri-error-warning-line size-4 shrink-0 text-text-warning"
                    />
                    <h4 className="min-w-0 flex-1 truncate system-sm-medium text-text-primary">
                      {issue.title}
                    </h4>
                    <span className="max-w-24 shrink-0 truncate rounded-md bg-components-badge-bg-gray-soft px-1.5 py-0.5 font-mono text-[10px] leading-3 text-text-tertiary">
                      {issue.node_type}
                    </span>
                  </div>
                  {messages.length > 0 && (
                    <ul className="flex flex-col gap-1 px-3 pt-1 pb-2.5">
                      {messages.map((message) => (
                        <li key={message.key} className="flex min-w-0 items-start gap-2">
                          <span
                            aria-hidden="true"
                            className="mt-1.5 size-1 shrink-0 rounded-full bg-text-warning"
                          />
                          <span className="min-w-0 flex-1 system-xs-regular wrap-break-word text-text-warning">
                            {message.text}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        ) : undefined}
      </DifyBuilderCard>
    )
  },
)
PreflightContextCard.displayName = 'PreflightContextCard'
