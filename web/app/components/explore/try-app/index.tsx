/* eslint-disable style/multiline-ternary */
'use client'
import type { FC } from 'react'
import type { App as AppType } from '@/models/explore'
import { RiCloseLine } from '@remixicon/react'
import * as React from 'react'
import { useState } from 'react'
import Loading from '@/app/components/base/loading'
import Modal from '@/app/components/base/modal/index'
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
  const [type, setType] = useState<TypeEnum>(() => (app && !isTrialApp ? TypeEnum.DETAIL : TypeEnum.TRY))
  const { data: appDetail, isLoading } = useGetTryAppInfo(appId)

  React.useEffect(() => {
    if (app && !isTrialApp && type !== TypeEnum.DETAIL)
      // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
      setType(TypeEnum.DETAIL)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, isTrialApp])

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
      ) : (
        <div className="flex h-full flex-col">
          <div className="flex shrink-0 justify-between pl-4">
            <Tab
              value={type}
              onChange={setType}
              disableTry={app ? !isTrialApp : false}
            />
            <Button
              size="large"
              variant="tertiary"
              className="flex size-7 items-center justify-center rounded-[10px] p-0 text-components-button-tertiary-text"
              onClick={onClose}
            >
              <RiCloseLine className="size-5" onClick={onClose} />
            </Button>
          </div>
          {/* Main content */}
          <div className="mt-2 flex h-0 grow justify-between space-x-2">
            {type === TypeEnum.TRY ? <App appId={appId} appDetail={appDetail!} /> : <Preview appId={appId} appDetail={appDetail!} />}
            <AppInfo
              className="w-[360px] shrink-0"
              appDetail={appDetail!}
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
