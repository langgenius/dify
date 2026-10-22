import type { TestResultCard as TestResultPayload } from '@dify/contracts/api/console/dify-builder/types.gen'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { DifyBuilderCard } from '../cards/card-shell'
import { useBuilderText } from '../copy/use-builder-text'
import { difyBuilderAppIdAtom } from '../store'
import { TestResultNativeOutputs, TestResultRunDetails } from './test-result-native-run'
import { TestResultOutputs } from './test-result-outputs'

export const TestResultCard = ({
  payload,
  invalidated,
}: {
  payload: TestResultPayload
  invalidated: boolean
}) => {
  const { locale, renderText } = useBuilderText(payload.reply_language)
  const { t } = useTranslation(['difyBuilder'], { lng: locale })
  const appId = useAtomValue(difyBuilderAppIdAtom)
  const outcome =
    payload.outcome ??
    (payload.status === 'succeeded' ? 'execution_succeeded_needs_review' : 'execution_failed')
  const succeeded = outcome === 'execution_succeeded_needs_review'
  const unknown = outcome === 'execution_unknown'
  const headline =
    outcome === 'required_output_unresolved'
      ? t(($) => $['testResult.requiredOutputUnresolved'], { ns: 'difyBuilder' })
      : undefined
  const reviewNote =
    renderText(payload.review_note) ||
    (succeeded
      ? t(($) => $['copy.replies.otherPathsAndGoalAcceptanceWereNotVerified'], {
          ns: 'difyBuilder',
        })
      : undefined)
  const outputsLabel = t(($) => $['testResult.terminalOutputs'], { ns: 'difyBuilder' })

  return (
    <DifyBuilderCard
      category={t(($) => $['cardCategory.test'], { ns: 'difyBuilder' })}
      headline={headline}
      invalidated={invalidated}
      status={{
        state: succeeded ? 'done' : unknown ? 'waiting' : 'failed',
        label: t(
          ($) =>
            succeeded
              ? $['testResult.statusPassed']
              : unknown
                ? $['testResult.executionUnknown']
                : $['testResult.statusFailed'],
          {
            ns: 'difyBuilder',
          },
        ),
        className: succeeded ? 'normal-case text-util-colors-green-green-700' : 'normal-case',
        icon: (
          <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
            <span
              className={
                succeeded
                  ? 'i-ri-checkbox-circle-line size-3.5'
                  : unknown
                    ? 'i-ri-time-line size-3.5'
                    : 'i-ri-close-circle-line size-3.5'
              }
            />
          </span>
        ),
      }}
    >
      <div className="flex min-w-0 flex-col gap-2 system-xs-regular text-text-secondary">
        {payload.failure_reason && (
          <p className="wrap-anywhere whitespace-pre-wrap">{renderText(payload.failure_reason)}</p>
        )}
        {reviewNote && <p className="wrap-anywhere whitespace-pre-wrap">{reviewNote}</p>}
        {!!payload.simulated_node_ids?.length && (
          <dl className="flex min-w-0 flex-col gap-1">
            <dt className="system-xs-medium">
              {t(($) => $['testResult.simulatedNodes'], { ns: 'difyBuilder' })}
            </dt>
            <dd className="wrap-anywhere whitespace-pre-wrap">
              {payload.simulated_node_ids.join(', ')}
            </dd>
          </dl>
        )}
        <ScrollArea className="max-h-80 min-w-0 rounded-sm">
          <ScrollAreaViewport
            role="region"
            aria-label={outputsLabel}
            style={{ overflowX: 'hidden' }}
            className="max-h-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-accent"
          >
            <ScrollAreaContent style={{ minWidth: 0 }} className="pr-3 pb-1">
              {payload.terminal_outputs != null ? (
                <TestResultOutputs outputs={payload.terminal_outputs} />
              ) : appId && payload.dify_run_id ? (
                <TestResultNativeOutputs
                  key={`${appId}:${payload.dify_run_id}`}
                  appId={appId}
                  runId={payload.dify_run_id}
                  failureReason={renderText(payload.failure_reason)}
                />
              ) : (
                <p>
                  {outcome === 'execution_failed' && !payload.dify_run_id
                    ? t(($) => $['testResult.noOutputs'], { ns: 'difyBuilder' })
                    : t(($) => $['testResult.outputsUnavailable'], {
                        ns: 'difyBuilder',
                      })}
                </p>
              )}
            </ScrollAreaContent>
          </ScrollAreaViewport>
          <ScrollAreaScrollbar>
            <ScrollAreaThumb />
          </ScrollAreaScrollbar>
        </ScrollArea>
        {appId && payload.dify_run_id && (
          <TestResultRunDetails appId={appId} runId={payload.dify_run_id} />
        )}
      </div>
    </DifyBuilderCard>
  )
}
