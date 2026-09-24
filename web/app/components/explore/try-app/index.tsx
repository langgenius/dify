'use client'
import type { RecommendedAppResponse } from '@dify/contracts/api/console/explore/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import * as React from 'react'
import { Suspense, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { useGetTryAppInfo } from '@/service/use-try-app'
import AppInfo from './app-info'
import Preview from './preview'
import { TypeEnum } from './types'

const App = React.lazy(() => import('./app'))

type Props = Readonly<{
  appId: RecommendedAppResponse['app_id']
  canTrial: RecommendedAppResponse['can_trial']
  categories?: RecommendedAppResponse['categories']
  templateName?: NonNullable<RecommendedAppResponse['app']>['name']
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
  canCreate = true,
  createButtonStepByStepTourTarget,
  onClose,
  onCreate,
}: Props) {
  const { t } = useTranslation(['common', 'explore'])
  const { data: appDetail, isLoading, isFetching, refetch } = useGetTryAppInfo(appId)
  const hasLoadError = !isLoading && !appDetail
  const retryLabelId = useId()
  const detailTabRef = useRef<HTMLButtonElement>(null)

  const handleRetry = async () => {
    const { data } = await refetch()
    if (data) detailTabRef.current?.focus()
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
        className="h-[calc(100dvh-16px)] max-h-[calc(100dvh-16px)] w-full max-w-[calc(100vw-16px)] min-w-7xl overflow-hidden overflow-x-auto border-none p-2 text-left align-middle"
      >
        <DialogTitle className="sr-only">
          {templateName ?? appDetail?.name ?? t(($) => $['apps.title'], { ns: 'explore' })}
        </DialogTitle>
        <Tabs defaultValue={TypeEnum.DETAIL} className="flex h-full flex-col">
          <div className="flex shrink-0 justify-between pl-4">
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
                  disabled={!appDetail}
                  className="pt-2 data-active:border-util-colors-blue-brand-blue-brand-500"
                >
                  <span className="system-md-semibold-uppercase">
                    {t(($) => $['tryApp.tabHeader.try'], { ns: 'explore' })}
                  </span>
                </TabsTab>
              )}
            </TabsList>
            <IconButton
              size="lg"
              variant="tertiary"
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              onClick={onClose}
            >
              <span aria-hidden className="i-ri-close-line size-5" />
            </IconButton>
          </div>
          <div className="mt-2 flex h-0 grow justify-between space-x-2">
            <TabsPanel value={TypeEnum.DETAIL} className="min-w-0 flex-1">
              {isLoading ? (
                <div className="flex h-full items-center justify-center">
                  <LoadingPlaceholder />
                </div>
              ) : hasLoadError ? (
                <div className="flex h-full flex-col items-center justify-center gap-5">
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
                    disabled={isFetching}
                    focusableWhenDisabled={isFetching}
                    aria-labelledby={retryLabelId}
                    onClick={handleRetry}
                  >
                    <span id={retryLabelId}>
                      {isFetching
                        ? t(($) => $['tryApp.retrying'], { ns: 'explore' })
                        : t(($) => $['operation.retry'], { ns: 'common' })}
                    </span>
                  </Button>
                </div>
              ) : appDetail ? (
                <Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center">
                      <LoadingPlaceholder />
                    </div>
                  }
                >
                  <Preview appId={appId} appDetail={appDetail} />
                </Suspense>
              ) : null}
            </TabsPanel>
            {canTrial && (
              <TabsPanel value={TypeEnum.TRY} className="min-w-0 flex-1">
                {appDetail && (
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
            {appDetail && (
              <Suspense fallback={<div className="w-90 shrink-0" />}>
                <AppInfo
                  className="w-90 shrink-0"
                  appDetail={appDetail}
                  appId={appId}
                  canCreate={canCreate}
                  categories={categories ?? []}
                  createButtonStepByStepTourTarget={createButtonStepByStepTourTarget}
                  onCreate={onCreate}
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
