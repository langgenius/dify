'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import Modal from '@/app/components/base/modal/index'
import Tab, { TypeEnum } from './tab'
import Button from '../../base/button'
import { RiCloseLine } from '@remixicon/react'
import AppInfo from './app-info'
import App from './app'
import Preview from './preview'
import { useGetTryAppInfo } from '@/service/use-try-app'
import Loading from '@/app/components/base/loading'

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
      className='h-[calc(100vh-32px)] max-w-[calc(100vw-32px)] p-2'
    >
      {isLoading ? (<div className='flex h-full items-center justify-center'>
        <Loading type='area' />
      </div>) : (
        <div className='flex h-full flex-col'>
          <div className='flex shrink-0 justify-between pl-4'>
            <Tab
              value={type}
              onChange={setType}
            />
            <Button
              size='large'
              variant='tertiary'
              className='flex size-7 items-center justify-center rounded-[10px] p-0 text-components-button-tertiary-text'
              onClick={onClose}
            >
              <RiCloseLine className='size-5' onClick={onClose} />
            </Button>
          </div>
          {/* Main content */}
          <div className='mt-2 flex h-0 grow justify-between space-x-2'>
            {type === TypeEnum.TRY ? <App appId={appId} appDetail={appDetail!} /> : <Preview appId={appId} appDetail={appDetail!} />}
            <AppInfo className='w-[360px] shrink-0' appDetail={appDetail!} category={category} onCreate={onCreate} />
          </div>
        </div>
      )}
    </Modal>
  )
}
export default React.memo(TryApp)
