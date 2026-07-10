/* eslint-disable style/multiline-ternary */
'use client'
import type { FC } from 'react'
import type { App as AppType } from '@/models/explore'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import { useSuspenseQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppUnavailable from '@/app/components/base/app-unavailable'
import Loading from '@/app/components/base/loading'
import { IS_CLOUD_EDITION } from '@/config'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useGetTryAppInfo } from '@/service/use-try-app'
import App from './app'
import AppInfo from './app-info'
import Preview from './preview'
import { TypeEnum } from './types'

type Props = Readonly<{
  appId: string
  app?: AppType
  canCreate?: boolean
  categories?: string[]
  createButtonStepByStepTourTarget?: string
  onClose: () => void
  onCreate: () => void
}>

const TryApp: FC<Props> = ({
  appId,
  app,
  canCreate = true,
  categories,
  createButtonStepByStepTourTarget,
  onClose,
  onCreate,
}) => {
  const { t } = useTranslation()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const isTrialApp = !!(app && app.can_trial && systemFeatures.enable_trial_app)
  const canUseTryTab = IS_CLOUD_EDITION && (app ? isTrialApp : true)
  const [type, setType] = useState<TypeEnum>(() => (canUseTryTab ? TypeEnum.TRY : TypeEnum.DETAIL))
  const activeType = canUseTryTab ? type : TypeEnum.DETAIL
  const { data: appDetail, isLoading, isError, error } = useGetTryAppInfo(appId)

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open)
          onClose()
      }}
    >
      <DialogContent className="h-[calc(100dvh-32px)] max-h-[calc(100dvh-32px)] w-full max-w-[calc(100vw-32px)] min-w-[1280px] overflow-hidden overflow-x-auto border-none p-2 text-left align-middle">

        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loading type="area" />
          </div>
        ) : isError ? (
          <div className="flex h-full items-center justify-center">
            <AppUnavailable className="size-auto" isUnknownReason={!error} unknownReason={error instanceof Error ? error.message : undefined} />
          </div>
        ) : !appDetail ? (
          <div className="flex h-full items-center justify-center">
            <AppUnavailable className="size-auto" isUnknownReason />
          </div>
        ) : (
          <Tabs
            value={activeType}
            onValueChange={selectedValue => setType(selectedValue)}
            className="flex h-full flex-col"
          >
            <div className="flex shrink-0 justify-between pl-4">
              <TabsList>
                {IS_CLOUD_EDITION && (
                  <TabsTab
                    value={TypeEnum.TRY}
                    disabled={app ? !isTrialApp : false}
                    className="pt-2 data-active:border-util-colors-blue-brand-blue-brand-500"
                  >
                    <span className="system-md-semibold-uppercase">{t($ => $['tryApp.tabHeader.try'], { ns: 'explore' })}</span>
                  </TabsTab>
                )}
                <TabsTab
                  value={TypeEnum.DETAIL}
                  className="pt-2 data-active:border-util-colors-blue-brand-blue-brand-500"
                >
                  <span className="system-md-semibold-uppercase">{t($ => $['tryApp.tabHeader.detail'], { ns: 'explore' })}</span>
                </TabsTab>
              </TabsList>
              <Button
                size="large"
                variant="tertiary"
                aria-label={t($ => $['operation.close'], { ns: 'common' })}
                className="flex size-7 items-center justify-center rounded-[10px] p-0 text-components-button-tertiary-text"
                onClick={onClose}
              >
                <span aria-hidden className="i-ri-close-line size-5" />
              </Button>
            </div>
            {/* Main content */}
            <div className="mt-2 flex h-0 grow justify-between space-x-2">
              {IS_CLOUD_EDITION && (
                <TabsPanel value={TypeEnum.TRY} className="min-w-0 flex-1">
                  <App appId={appId} appDetail={appDetail} />
                </TabsPanel>
              )}
              <TabsPanel value={TypeEnum.DETAIL} className="min-w-0 flex-1">
                <Preview appId={appId} appDetail={appDetail} />
              </TabsPanel>
              <AppInfo
                className="w-[360px] shrink-0"
                appDetail={appDetail}
                appId={appId}
                canCreate={canCreate}
                categories={categories}
                createButtonStepByStepTourTarget={createButtonStepByStepTourTarget}
                onCreate={onCreate}
              />
            </div>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}
export default React.memo(TryApp)
