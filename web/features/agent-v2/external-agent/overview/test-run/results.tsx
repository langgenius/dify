import type { TestAgentResultTab, TestAgentRun } from './use-test-run'
import { cn } from '@langgenius/dify-ui/cn'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import { useTranslation } from 'react-i18next'
import StatusContainer from '@/app/components/workflow/run/status-container'

type TestAgentResultsProps = {
  run: TestAgentRun
  tab: TestAgentResultTab
  onTabChange: (tab: TestAgentResultTab) => void
}

export function TestAgentResults({ run, tab, onTabChange }: TestAgentResultsProps) {
  const { t, i18n } = useTranslation(['agentRoster'])
  const secondsFormat = new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
  const succeeded = run.status === 'succeeded'
  const failed = run.status === 'failed'
  const stopping = run.status === 'stopping'
  const stopped = run.status === 'stopped'
  const completed = succeeded || failed || stopped
  const traceSteps = run.tracing ? run.traceSteps : []
  const statusLabel = {
    running: t(($) => $['external.overview.testRun.running']),
    stopping: t(($) => $['external.overview.testRun.stopping']),
    stopped: t(($) => $['external.overview.testRun.stopped']),
    succeeded: t(($) => $['external.overview.testRun.success']),
    failed: t(($) => $['external.overview.testRun.failed']),
  }[run.status]

  return (
    <div className="flex shrink-0 flex-col gap-4">
      <StatusContainer status={stopping ? 'running' : run.status}>
        <dl className="relative grid grid-cols-3 gap-2">
          <div>
            <dt className="mb-1 system-2xs-medium-uppercase text-text-tertiary">
              {t(($) => $['external.overview.testRun.status'])}
            </dt>
            <dd
              className={cn(
                'flex items-center gap-1 system-xs-semibold-uppercase',
                stopped && 'text-text-warning',
              )}
            >
              <StatusDot
                status={succeeded ? 'success' : failed ? 'error' : stopped ? 'warning' : 'normal'}
              />
              {statusLabel}
            </dd>
          </div>
          {(completed || stopping) && (
            <>
              <div>
                <dt className="mb-1 system-2xs-medium-uppercase text-text-tertiary">
                  {t(($) => $['external.overview.testRun.elapsedTime'])}
                </dt>
                <dd className="system-sm-medium text-text-secondary">
                  {stopping ? (
                    <span
                      aria-hidden
                      className="my-1 block h-2 w-12 rounded-sm bg-text-quaternary/20"
                    />
                  ) : (
                    t(($) => $['external.overview.testRun.elapsedValue'], {
                      value: secondsFormat.format(run.elapsedSeconds),
                    })
                  )}
                </dd>
              </div>
              <div>
                <dt className="mb-1 system-2xs-medium-uppercase text-text-tertiary">
                  {t(($) => $['external.overview.testRun.totalTokens'])}
                </dt>
                <dd className="system-sm-medium text-text-secondary">
                  {stopping ? (
                    <span
                      aria-hidden
                      className="my-1 block h-2 w-16 rounded-sm bg-text-quaternary/20"
                    />
                  ) : run.totalTokens === null ? (
                    t(($) => $['external.overview.testRun.notProvided'])
                  ) : (
                    t(($) => $['external.overview.testRun.tokens'], {
                      value: new Intl.NumberFormat(i18n.language).format(run.totalTokens),
                    })
                  )}
                </dd>
              </div>
            </>
          )}
        </dl>
        {stopped && (
          <p className="relative mt-2 border-t-[0.5px] border-divider-deep pt-2 system-xs-regular text-text-warning">
            {t(($) => $['external.overview.testRun.stoppedDescription'])}
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
          {succeeded ? (
            <div className="space-y-2 body-md-regular wrap-break-word text-text-primary">
              {run.response.split(/\n{2,}/).map((paragraph) => (
                <p key={paragraph} className="whitespace-pre-wrap">
                  {paragraph}
                </p>
              ))}
            </div>
          ) : failed ? (
            <p className="system-sm-regular text-text-destructive">
              {t(($) => $['external.overview.testRun.failedToast'])}
            </p>
          ) : !stopped ? (
            <p className="system-xs-regular text-text-tertiary">
              {t(($) => $['external.overview.testRun.waitingResult'])}
            </p>
          ) : null}
        </TabsPanel>
        <TabsPanel value="tracing" className="space-y-1 pt-2">
          {traceSteps.length > 0 ? (
            <>
              <p className="py-0.5 body-xs-regular text-text-tertiary">
                {t(($) => $['external.overview.testRun.stepsReceived'], {
                  count: traceSteps.length,
                })}
              </p>
              {traceSteps.map((step) => (
                <Collapsible
                  key={step.id}
                  className="rounded-[10px] border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs"
                >
                  <CollapsibleTrigger className="group flex min-h-9 w-full items-center rounded-[10px] py-2 ps-1.5 pe-3 text-start">
                    <span
                      aria-hidden
                      className="i-ri-arrow-right-s-line size-4 shrink-0 text-text-tertiary group-data-panel-open:rotate-90 rtl:-scale-x-100"
                    />
                    <span className="min-w-0 flex-1 system-sm-semibold wrap-anywhere text-text-secondary">
                      {step.name}
                    </span>
                    <span className="shrink-0 system-xs-regular text-text-tertiary">
                      {t(($) => $['external.overview.testRun.elapsedValue'], {
                        value: secondsFormat.format(step.elapsedSeconds),
                      })}
                    </span>
                    <span
                      aria-hidden
                      className="ms-2 i-ri-checkbox-circle-fill size-4 shrink-0 text-text-success"
                    />
                  </CollapsibleTrigger>
                  <CollapsiblePanel>
                    <dl className="space-y-3 border-t border-divider-subtle p-3">
                      <div>
                        <dt className="mb-1 system-2xs-medium-uppercase text-text-tertiary">
                          {t(($) => $['external.overview.testRun.input'])}
                        </dt>
                        <dd className="rounded-md bg-background-section p-2 system-xs-regular wrap-anywhere whitespace-pre-wrap text-text-secondary">
                          {step.input}
                        </dd>
                      </div>
                      <div>
                        <dt className="mb-1 system-2xs-medium-uppercase text-text-tertiary">
                          {t(($) => $['external.overview.testRun.output'])}
                        </dt>
                        <dd className="rounded-md bg-background-section p-2 system-xs-regular wrap-anywhere whitespace-pre-wrap text-text-secondary">
                          {step.output}
                        </dd>
                      </div>
                    </dl>
                  </CollapsiblePanel>
                </Collapsible>
              ))}
            </>
          ) : (
            <p className="py-0.5 body-xs-regular text-text-tertiary">
              {run.tracing
                ? t(($) => $['external.overview.testRun.noTrace'])
                : t(($) => $['external.overview.testRun.tracingOff'])}
            </p>
          )}
        </TabsPanel>
      </Tabs>
    </div>
  )
}
