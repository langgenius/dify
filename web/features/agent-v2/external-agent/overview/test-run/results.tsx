import type { TestAgentResultTab, TestAgentRun } from './use-test-run'
import { cn } from '@langgenius/dify-ui/cn'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import { useTranslation } from 'react-i18next'
import StatusContainer from '@/app/components/workflow/run/status-container'
import { ExternalAgentInvocationTrace } from '../../invocation-trace'

export function TestAgentResults({
  run,
  tab,
  onTabChange,
}: {
  run: TestAgentRun
  tab: TestAgentResultTab
  onTabChange: (tab: TestAgentResultTab) => void
}) {
  const { t, i18n } = useTranslation(['agentRoster'])
  const succeeded = run.status === 'succeeded'
  const failed = run.status === 'failed'
  const stopping = run.status === 'stopping'
  const stopped = run.status === 'stopped'
  const ended = run.status === 'ended'
  const completed = succeeded || failed || stopped || ended
  const labels = {
    running: t(($) => $['external.overview.testRun.running']),
    stopping: t(($) => $['external.overview.testRun.stopping']),
    stopped: t(($) => $['external.overview.testRun.stopped']),
    succeeded: t(($) => $['external.overview.testRun.success']),
    failed: t(($) => $['external.overview.testRun.failed']),
    ended: t(($) => $['external.overview.testRun.ended']),
    unknown: t(($) => $['external.overview.testRun.unsupportedState']),
  }
  const outputs = run.result?.outputs
  return (
    <div className="flex shrink-0 flex-col gap-4">
      <StatusContainer status={stopping ? 'running' : ended ? 'stopped' : run.status}>
        <dl className="relative grid grid-cols-3 gap-2">
          <div>
            <dt className="mb-1 system-2xs-medium-uppercase text-text-tertiary">
              {t(($) => $['external.overview.testRun.status'])}
            </dt>
            <dd
              className={cn(
                'flex items-center gap-1 system-xs-semibold-uppercase',
                (stopped || ended) && 'text-text-warning',
              )}
            >
              <StatusDot
                status={
                  succeeded ? 'success' : failed ? 'error' : stopped || ended ? 'warning' : 'normal'
                }
              />
              {labels[run.status]}
            </dd>
          </div>
          {(completed || stopping) && (
            <>
              <div>
                <dt className="mb-1 system-2xs-medium-uppercase text-text-tertiary">
                  {t(($) => $['external.overview.testRun.elapsedTime'])}
                </dt>
                <dd className="system-sm-medium text-text-secondary">
                  {run.elapsedSeconds === null
                    ? t(($) => $['external.overview.testRun.notProvided'])
                    : t(($) => $['external.overview.testRun.elapsedSeconds'], {
                        value: new Intl.NumberFormat(i18n.language, {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                        }).format(run.elapsedSeconds),
                      })}
                </dd>
              </div>
              <div>
                <dt className="mb-1 system-2xs-medium-uppercase text-text-tertiary">
                  {t(($) => $['external.overview.testRun.totalTokens'])}
                </dt>
                <dd className="system-sm-medium text-text-secondary">
                  {t(($) => $['external.overview.testRun.notProvided'])}
                </dd>
              </div>
            </>
          )}
        </dl>
        {(stopped || ended) && (
          <p className="relative mt-2 border-t-[0.5px] border-divider-deep pt-2 system-xs-regular text-text-warning">
            {ended
              ? t(($) => $['external.overview.testRun.endedDescription'])
              : run.result?.metadata.cancellation_state === 'confirmed'
                ? t(($) => $['external.overview.testRun.stoppedDescription'])
                : t(($) => $['external.overview.testRun.stoppedLocallyDescription'])}
          </p>
        )}
      </StatusContainer>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (value === 'result' || value === 'tracing') onTabChange(value)
        }}
      >
        <TabsList className="gap-6 border-b-[0.5px] border-divider-subtle">
          <TabsTab value="result" className="pt-2 pb-2.5 system-sm-semibold-uppercase">
            {t(($) => $['external.overview.testRun.result'])}
          </TabsTab>
          <TabsTab value="tracing" className="pt-2 pb-2.5 system-sm-semibold-uppercase">
            {t(($) => $['external.overview.tracing'])}
          </TabsTab>
        </TabsList>
        <TabsPanel value="result" className="pt-3">
          {succeeded && outputs ? (
            <div className="space-y-3 body-md-regular wrap-break-word text-text-primary">
              {Object.entries(outputs).map(([name, value]) => (
                <div key={name}>
                  {name !== 'text' && (
                    <h4 className="mb-1 system-xs-medium-uppercase text-text-tertiary">{name}</h4>
                  )}
                  {typeof value === 'string' ? (
                    <p className="whitespace-pre-wrap">{value}</p>
                  ) : (
                    <pre className="max-h-80 overflow-auto rounded-md bg-background-section p-2 system-xs-regular wrap-anywhere whitespace-pre-wrap">
                      {JSON.stringify(value, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          ) : run.result?.error_message ? (
            <p className="system-sm-regular text-text-destructive">{run.result.error_message}</p>
          ) : failed ? (
            <p className="system-sm-regular text-text-destructive">
              {t(($) => $['external.overview.testRun.failedToast'])}
            </p>
          ) : !completed ? (
            <p className="system-xs-regular text-text-tertiary">
              {t(($) => $['external.overview.testRun.waitingResult'])}
            </p>
          ) : null}
        </TabsPanel>
        <TabsPanel value="tracing" className="space-y-1 pt-2">
          {run.tracing ? (
            <ExternalAgentInvocationTrace
              key={run.currentInvocationId}
              invocationId={run.currentInvocationId}
              enabled={tab === 'tracing'}
            />
          ) : (
            <p className="py-0.5 body-xs-regular text-text-tertiary">
              {t(($) => $['external.overview.testRun.tracingOff'])}
            </p>
          )}
        </TabsPanel>
      </Tabs>
    </div>
  )
}
