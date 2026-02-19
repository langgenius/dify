/* eslint-disable style/multiline-ternary */
'use client'
import type { FC } from 'react'
import type { App as AppType } from '@/models/explore'
import * as React from 'react'
import { useState } from 'react'
import AppUnavailable from '@/app/components/base/app-unavailable'
import Loading from '@/app/components/base/loading'
import Modal from '@/app/components/base/modal/index'
import { IS_CLOUD_EDITION } from '@/config'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useGetTryAppInfo } from '@/service/use-try-app'
import Button from '../../base/button'
import App from './app'
import AppInfo from './app-info'
import Preview from './preview'
import Tab, { TypeEnum } from './tab'

type Props = {
  appId: string
  app?: AppType
  category?: string
  onClose: () => void
  onCreate: () => void
}

const TryApp: FC<Props> = ({
  appId,
  app,
  category,
  onClose,
  onCreate,
}) => {
  const { systemFeatures } = useGlobalPublicStore()
  const isTrialApp = !!(app && app.can_trial && systemFeatures.enable_trial_app)
  const canUseTryTab = IS_CLOUD_EDITION && (app ? isTrialApp : true)
  const [type, setType] = useState<TypeEnum>(() => (canUseTryTab ? TypeEnum.TRY : TypeEnum.DETAIL))
  const activeType = canUseTryTab ? type : TypeEnum.DETAIL
  const { data: appDetail, isLoading, isError, error } = useGetTryAppInfo(appId)

  return (
    <Modal
      isShow
      onClose={onClose}
      className="h-[calc(100vh-32px)] min-w-[1280px] max-w-[calc(100vw-32px)] overflow-x-auto p-2"
    >
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
              category={category}
              onCreate={onCreate}
            />
          </div>
        </div>
      )}
    </Modal>
  )
}
export default React.memo(TryApp)
