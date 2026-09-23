'use client'
import type { RecommendedAppResponse } from '@dify/contracts/api/console/explore/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import * as React from 'react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { useGetTryAppInfo } from '@/service/use-try-app'
import App from './app'
import AppInfo from './app-info'
import Preview from './preview'
import { TypeEnum } from './types'

type Props = Readonly<{
  app: RecommendedAppResponse
  canCreate?: boolean
  createButtonStepByStepTourTarget?: string
  onClose: () => void
  onCreate: () => void
}>

function TryApp({
  app,
  canCreate = true,
  createButtonStepByStepTourTarget,
  onClose,
  onCreate,
}: Props) {
  const { t } = useTranslation(['common', 'explore'])
  const appId = app.app_id
  const canUseTryTab = app.can_trial
  const [type, setType] = useState<TypeEnum>(TypeEnum.DETAIL)
  const activeType = canUseTryTab ? type : TypeEnum.DETAIL
  const { data: appDetail, isLoading, isError, isFetching, refetch } = useGetTryAppInfo(appId)
  const hasLoadError = isError || (!isLoading && !appDetail)
  const hasRetriedRef = useRef(false)
  const restoreFocusAfterRetry = useCallback(
    (node: HTMLButtonElement | null) => {
      if (node && hasRetriedRef.current && !isFetching) {
        node.focus()
        hasRetriedRef.current = false
      }
    },
    [isFetching],
  )

  const handleRetry = () => {
    hasRetriedRef.current = true
    setType(TypeEnum.DETAIL)
    void refetch()
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="h-[calc(100dvh-32px)] max-h-[calc(100dvh-32px)] w-full max-w-[calc(100vw-32px)] min-w-7xl overflow-hidden overflow-x-auto border-none p-2 text-left align-middle">
        <DialogTitle className="sr-only">
          {app.app?.name ?? appDetail?.name ?? t(($) => $['apps.title'], { ns: 'explore' })}
        </DialogTitle>
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <LoadingPlaceholder />
          </div>
        ) : hasLoadError ? (
          <div className="flex h-full flex-col">
            <div className="flex h-9 shrink-0 items-center pl-4">
              <span className="border-b-2 border-util-colors-blue-brand-blue-brand-500 py-2 system-md-semibold-uppercase text-text-primary">
                {t(($) => $['tryApp.tabHeader.detail'], { ns: 'explore' })}
              </span>
            </div>
            <div
              className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5"
              role="alert"
            >
              <span className="flex size-12 items-center justify-center rounded-xl bg-background-body">
                <span aria-hidden className="i-ri-error-warning-line size-6 text-text-tertiary" />
              </span>
              <p className="title-xl-semi-bold text-text-primary">
                {t(($) => $['tryApp.loadError'], { ns: 'explore' })}
              </p>
              <Button variant="secondary" disabled={isFetching} onClick={handleRetry}>
                {isFetching
                  ? t(($) => $['tryApp.retrying'], { ns: 'explore' })
                  : t(($) => $['operation.retry'], { ns: 'common' })}
              </Button>
            </div>
          </div>
        ) : appDetail ? (
          <Tabs
            value={activeType}
            onValueChange={(selectedValue) => setType(selectedValue)}
            className="flex h-full flex-col"
          >
            <div className="flex shrink-0 justify-between pl-4">
              <TabsList>
                <TabsTab
                  ref={restoreFocusAfterRetry}
                  value={TypeEnum.DETAIL}
                  className="pt-2 data-active:border-util-colors-blue-brand-blue-brand-500"
                >
                  <span className="system-md-semibold-uppercase">
                    {t(($) => $['tryApp.tabHeader.detail'], { ns: 'explore' })}
                  </span>
                </TabsTab>
                {canUseTryTab && (
                  <TabsTab
                    value={TypeEnum.TRY}
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
            {/* Main content */}
            <div className="mt-2 flex h-0 grow justify-between space-x-2">
              <TabsPanel value={TypeEnum.DETAIL} className="min-w-0 flex-1">
                <Preview appId={appId} appDetail={appDetail} />
              </TabsPanel>
              {canUseTryTab && (
                <TabsPanel value={TypeEnum.TRY} className="min-w-0 flex-1">
                  <App appId={appId} appDetail={appDetail} />
                </TabsPanel>
              )}
              <AppInfo
                className="w-90 shrink-0"
                appDetail={appDetail}
                appId={appId}
                canCreate={canCreate}
                categories={app.categories ?? []}
                createButtonStepByStepTourTarget={createButtonStepByStepTourTarget}
                onCreate={onCreate}
              />
            </div>
          </Tabs>
        ) : null}
        {(isLoading || hasLoadError) && (
          <IconButton
            size="lg"
            variant="tertiary"
            className="absolute top-2 right-2"
            aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            onClick={onClose}
          >
            <span aria-hidden className="i-ri-close-line size-5" />
          </IconButton>
        )}
      </DialogContent>
    </Dialog>
  )
}
export default React.memo(TryApp)
