/* eslint-disable style/multiline-ternary */
'use client'
import type { FC } from 'react'
import { RiCloseLine } from '@remixicon/react'
import * as React from 'react'
import { useState } from 'react'
import Loading from '@/app/components/base/loading'
import Modal from '@/app/components/base/modal/index'
import { useGetTryAppInfo } from '@/service/use-try-app'
import Button from '../../base/button'
import App from './app'
import AppInfo from './app-info'
import Preview from './preview'
import Tab, { TypeEnum } from './tab'

type Props = {
  appId: string
  category?: string
  onClose: () => void
  onCreate: () => void
}

const TryApp: FC<Props> = ({
  appId,
  category,
  onClose,
  onCreate,
}) => {
  const [type, setType] = useState<TypeEnum>(TypeEnum.TRY)
  const { data: appDetail, isLoading } = useGetTryAppInfo(appId)

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
