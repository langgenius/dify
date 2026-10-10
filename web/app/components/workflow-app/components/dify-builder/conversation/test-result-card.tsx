import type { TestResultCard as TestResultPayload } from '@dify/contracts/api/console/dify-builder/types.gen'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { DifyBuilderCard } from '../cards/card-shell'

export const TestResultCard = ({
  payload,
  invalidated,
}: {
  payload: TestResultPayload
  invalidated: boolean
}) => {
  const { t } = useTranslation(['workflow'])
  const summaryId = useId()
  const outputsSummaryId = `${summaryId}-outputs`
  const nodesSummaryId = `${summaryId}-nodes`
  const outcome =
    payload.outcome ??
    (payload.status === 'succeeded' ? 'execution_succeeded_needs_review' : 'execution_failed')
  const needsReview = outcome === 'execution_succeeded_needs_review'
  const headline = t(
    ($) => {
      switch (outcome) {
        case 'execution_succeeded_needs_review':
          return $['difyBuilder.testResult.executionSucceeded']
        case 'required_output_unresolved':
          return $['difyBuilder.testResult.requiredOutputUnresolved']
        case 'execution_failed':
          return $['difyBuilder.testResult.executionFailed']
        case 'execution_unknown':
          return $['difyBuilder.testResult.executionUnknown']
      }
    },
    { ns: 'workflow' },
  )
  const outputsLabel = t(($) => $['difyBuilder.testResult.terminalOutputs'], { ns: 'workflow' })
  const nodesLabel = t(($) => $['difyBuilder.testResult.observedNodes'], { ns: 'workflow' })

  return (
    <DifyBuilderCard
      category={t(($) => $['difyBuilder.cardCategory.test'], { ns: 'workflow' })}
      headline={headline}
      invalidated={invalidated}
      status={
        needsReview
          ? undefined
          : {
              state:
                outcome === 'execution_failed'
                  ? 'failed'
                  : outcome === 'required_output_unresolved'
                    ? 'blocked'
                    : 'waiting',
            }
      }
      subheadline={payload.failure_reason}
    >
      <div className="flex min-w-0 flex-col gap-2 system-xs-regular text-text-secondary">
        {needsReview && (
          <p>{t(($) => $['difyBuilder.testResult.reviewRequired'], { ns: 'workflow' })}</p>
        )}
        {payload.review_note && (
          <p className="wrap-break-word whitespace-pre-wrap">{payload.review_note}</p>
        )}
        <p>{t(($) => $['difyBuilder.testResult.scopeLimit'], { ns: 'workflow' })}</p>
        {payload.terminal_outputs == null ? (
          <p>{t(($) => $['difyBuilder.testResult.outputsUnavailable'], { ns: 'workflow' })}</p>
        ) : (
          <details aria-labelledby={outputsSummaryId} className="min-w-0">
            <summary
              id={outputsSummaryId}
              className="cursor-pointer rounded-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-accent"
            >
              {outputsLabel}
            </summary>
            <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-background-section p-2 font-mono wrap-anywhere whitespace-pre-wrap">
              {JSON.stringify(payload.terminal_outputs, null, 2)}
            </pre>
          </details>
        )}
        <details aria-labelledby={nodesSummaryId} className="min-w-0">
          <summary
            id={nodesSummaryId}
            className="cursor-pointer rounded-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-accent"
          >
            {nodesLabel}
          </summary>
          <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-background-section p-2 font-mono wrap-anywhere whitespace-pre-wrap">
            {JSON.stringify(payload.executed_node_ids ?? [], null, 2)}
          </pre>
        </details>
        {payload.dify_run_id && (
          <dl>
            <dt>{t(($) => $['difyBuilder.testResult.runId'], { ns: 'workflow' })}</dt>
            <dd className="font-mono wrap-anywhere">{payload.dify_run_id}</dd>
          </dl>
        )}
      </div>
    </DifyBuilderCard>
  )
}
