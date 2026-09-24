'use client'
import type { RecommendedAppResponse } from '@dify/contracts/api/console/explore/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { Suspense, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { consoleQuery } from '@/service/console'
import AppInfo from './app-info'
import Preview from './preview'
import { TypeEnum } from './types'

const App = React.lazy(() => import('./app'))

type Props = Readonly<{
  appId: RecommendedAppResponse['app_id']
  canTrial: RecommendedAppResponse['can_trial']
  categories?: RecommendedAppResponse['categories']
  templateName?: NonNullable<RecommendedAppResponse['app']>['name']
  templateMode?: NonNullable<RecommendedAppResponse['app']>['mode']
  canCreate?: boolean
  createButtonStepByStepTourTarget?: string
  onClose: () => void
  onCreate: () => void
}>

function TryApp({
  appId,
  canTrial,
  categories,
  templateName,
  templateMode,
  canCreate = true,
  createButtonStepByStepTourTarget,
  onClose,
  onCreate,
}: Props) {
  const { t } = useTranslation(['common', 'explore'])
  const {
    data: appDetail,
    isLoading,
    isFetching,
    isFetchedAfterMount,
    errorUpdateCount,
    refetch,
  } = useQuery(
    consoleQuery.trialApps.byAppId.get.queryOptions({
      input: { params: { app_id: appId } },
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    }),
  )
  const isAgent = templateMode === 'agent' || appDetail?.mode === 'agent'
  const composerQuery = useQuery(
    consoleQuery.trialApps.byAppId.agentComposer.get.queryOptions({
      input: { params: { app_id: appId } },
      enabled: isAgent,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    }),
  )
  const agentLoading = isAgent && composerQuery.isLoading && !composerQuery.isFetchedAfterMount
  // On reopen, the cache can hold an old error; show loading during this observer's first fetch.
  const hasLoadError =
    (!appDetail && (!isLoading || isFetchedAfterMount)) ||
    (isAgent &&
      !composerQuery.data &&
      (!composerQuery.isLoading || composerQuery.isFetchedAfterMount))
  const hasAgentPreview = isAgent && !!appDetail && !!composerQuery.data && !hasLoadError
  const isInitialLoading = !hasLoadError && ((isLoading && !isFetchedAfterMount) || agentLoading)
  const keepErrorForExit =
    hasLoadError || errorUpdateCount > 0 || composerQuery.errorUpdateCount > 0
  const isRetrying = isFetching || composerQuery.isFetching
  const retryLabelId = useId()
  const detailTabRef = useRef<HTMLButtonElement>(null)

  const handleRetry = async () => {
    const results = await Promise.all([
      appDetail ? Promise.resolve(appDetail) : refetch().then((result) => result.data),
      ...(isAgent
        ? [
            composerQuery.data
              ? Promise.resolve(composerQuery.data)
              : composerQuery.refetch().then((result) => result.data),
          ]
        : []),
    ])
    if (results.every((result) => result !== undefined)) detailTabRef.current?.focus()
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        initialFocus={detailTabRef}
        className="h-[calc(100dvh-16px)] max-h-[calc(100dvh-16px)] w-full max-w-[calc(100vw-16px)] overflow-hidden border-none p-2 text-left align-middle"
      >
        <DialogTitle className="sr-only">
          {templateName ?? appDetail?.name ?? t(($) => $['apps.title'], { ns: 'explore' })}
        </DialogTitle>
        <IconButton
          size="lg"
          variant="tertiary"
          className="absolute top-2 right-2"
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
          onClick={onClose}
        >
          <span aria-hidden className="i-ri-close-line size-5" />
        </IconButton>
        <Tabs defaultValue={TypeEnum.DETAIL} className="flex h-full flex-col">
          <div className="flex shrink-0 pr-10 pl-4">
            <TabsList>
              <TabsTab
                ref={detailTabRef}
                value={TypeEnum.DETAIL}
                className="pt-2 data-active:border-util-colors-blue-brand-blue-brand-500"
              >
                <span className="system-md-semibold-uppercase">
                  {t(($) => $['tryApp.tabHeader.detail'], { ns: 'explore' })}
                </span>
              </TabsTab>
              {canTrial && (
                <TabsTab
                  value={TypeEnum.TRY}
                  disabled={!appDetail || hasLoadError || agentLoading}
                  className="pt-2 data-active:border-util-colors-blue-brand-blue-brand-500"
                >
                  <span className="system-md-semibold-uppercase">
                    {t(($) => $['tryApp.tabHeader.try'], { ns: 'explore' })}
                  </span>
                </TabsTab>
              )}
            </TabsList>
          </div>
          <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto lg:flex-row lg:overflow-hidden">
            <TabsPanel
              value={TypeEnum.DETAIL}
              className={cn(
                '@container/agent-preview min-w-0 shrink-0 lg:min-h-0 lg:flex-1',
                hasAgentPreview ? 'h-auto' : 'h-[75dvh] lg:h-auto',
              )}
            >
              {isInitialLoading ? (
                <div className="flex h-full items-center justify-center">
                  <LoadingPlaceholder />
                </div>
              ) : (
                <div className={cn('relative size-full', hasAgentPreview && 'max-lg:h-auto')}>
                  {keepErrorForExit && (
                    <div
                      aria-hidden={!hasLoadError}
                      inert={!hasLoadError}
                      className={cn(
                        'absolute inset-0 flex flex-col items-center justify-center gap-5 transition-opacity duration-150 motion-reduce:transition-none',
                        hasLoadError ? 'opacity-100' : 'pointer-events-none opacity-0',
                      )}
                    >
                      <div className="flex flex-col items-center gap-5" role="alert">
                        <span className="flex size-12 items-center justify-center rounded-xl bg-background-body">
                          <span
                            aria-hidden
                            className="i-ri-error-warning-line size-6 text-text-tertiary"
                          />
                        </span>
                        <p className="title-xl-semi-bold text-text-primary">
                          {t(($) => $['tryApp.loadError'], { ns: 'explore' })}
                        </p>
                      </div>
                      <Button
                        variant="secondary-accent"
                        className="flex-row-reverse"
                        loading={isRetrying}
                        aria-labelledby={retryLabelId}
                        onClick={handleRetry}
                      >
                        <span id={retryLabelId}>
                          {isRetrying
                            ? t(($) => $['tryApp.retrying'], { ns: 'explore' })
                            : t(($) => $['operation.retry'], { ns: 'common' })}
                        </span>
                      </Button>
                    </div>
                  )}
                  {appDetail && !hasLoadError && (
                    <div
                      className={cn(
                        'size-full opacity-100 transition-opacity duration-150 motion-reduce:transition-none starting:opacity-0',
                        hasAgentPreview && 'max-lg:h-auto',
                      )}
                    >
                      <Suspense
                        fallback={
                          <div className="flex h-full items-center justify-center">
                            <LoadingPlaceholder />
                          </div>
                        }
                      >
                        <Preview
                          appId={appId}
                          appDetail={appDetail}
                          agentComposer={composerQuery.data}
                        />
                      </Suspense>
                    </div>
                  )}
                </div>
              )}
            </TabsPanel>
            {canTrial && (
              <TabsPanel
                value={TypeEnum.TRY}
                className="h-[75dvh] min-w-0 shrink-0 lg:h-auto lg:min-h-0 lg:flex-1"
              >
                {appDetail && !hasLoadError && !agentLoading && (
                  <Suspense
                    fallback={
                      <div className="flex h-full items-center justify-center">
                        <LoadingPlaceholder />
                      </div>
                    }
                  >
                    <App appId={appId} appDetail={appDetail} />
                  </Suspense>
                )}
              </TabsPanel>
            )}
            {appDetail && !hasLoadError && !agentLoading && (
              <Suspense fallback={<div className="w-full shrink-0 lg:w-90" />}>
                <AppInfo
                  className="h-auto w-full shrink-0 lg:h-full lg:w-90"
                  appDetail={appDetail}
                  appId={appId}
                  canCreate={canCreate}
                  categories={categories ?? []}
                  createButtonStepByStepTourTarget={createButtonStepByStepTourTarget}
                  onCreate={onCreate}
                  agentComposer={composerQuery.data}
                />
              </Suspense>
            )}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
export default React.memo(TryApp)
