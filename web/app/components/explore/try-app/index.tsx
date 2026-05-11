/* eslint-disable style/multiline-ternary */
'use client'
import type { FC } from 'react'
import type { App as AppType } from '@/models/explore'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { useSuspenseQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useState } from 'react'
import AppUnavailable from '@/app/components/base/app-unavailable'
import Loading from '@/app/components/base/loading'
import { IS_CLOUD_EDITION } from '@/config'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { useGetTryAppInfo } from '@/service/use-try-app'
import App from './app'
import AppInfo from './app-info'
import Preview from './preview'
import Tab, { TypeEnum } from './tab'

type Props = {
  appId: string
  app?: AppType
  categories?: string[]
  onClose: () => void
  onCreate: () => void
}

const TryApp: FC<Props> = ({
  appId,
  app,
  categories,
  onClose,
  onCreate,
}) => {
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
      <DialogContent className="h-[calc(100vh-32px)] max-h-none w-full max-w-[calc(100vw-32px)] min-w-[1280px] overflow-hidden overflow-x-auto border-none p-2 text-left align-middle">

        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loading type="area" />
          </div>
        ) : isError ? (
          <div className="flex h-full items-center justify-center">
            <AppUnavailable className="h-auto w-auto" isUnknownReason={!error} unknownReason={error instanceof Error ? error.message : undefined} />
          </div>
        ) : !appDetail ? (
          <div className="flex h-full items-center justify-center">
            <AppUnavailable className="h-auto w-auto" isUnknownReason />
          </div>
        ) : (
          <div className="flex h-full flex-col">
            <div className="flex shrink-0 justify-between pl-4">
              <Tab
                value={activeType}
                onChange={setType}
                disableTry={app ? !isTrialApp : false}
              />
              <Button
                size="large"
                variant="tertiary"
                className="flex size-7 items-center justify-center rounded-[10px] p-0 text-components-button-tertiary-text"
                onClick={onClose}
              >
                <span className="i-ri-close-line size-5" />
              </Button>
            </div>
            {/* Main content */}
            <div className="mt-2 flex h-0 grow justify-between space-x-2">
              {activeType === TypeEnum.TRY ? <App appId={appId} appDetail={appDetail} /> : <Preview appId={appId} appDetail={appDetail} />}
              <AppInfo
                className="w-[360px] shrink-0"
                appDetail={appDetail}
                appId={appId}
                categories={categories}
                onCreate={onCreate}
              />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
export default React.memo(TryApp)
