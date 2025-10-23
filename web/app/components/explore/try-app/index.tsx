'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import Modal from '@/app/components/base/modal/index'
import Tab, { TypeEnum } from './tab'
import Button from '../../base/button'
import { RiCloseLine } from '@remixicon/react'
import AppInfo from './app-info'
import App from './app'

type Props = {
  appId: string
  onClose: () => void
}

const TryApp: FC<Props> = ({
  appId,
  onClose,
}) => {
  const [type, setType] = useState<TypeEnum>(TypeEnum.TRY)

  return (
    <Modal
      isShow
      onClose={onClose}
      className='h-[calc(100vh-32px)] max-w-[calc(100vw-32px)] p-2'
    >
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
        <div className='mt-2 flex grow justify-between space-x-2'>
          <App appId={appId} />
          <AppInfo className='w-[360px]' />
        </div>
      </div>
    </Modal>
  )
}
export default React.memo(TryApp)
