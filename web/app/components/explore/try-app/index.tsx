'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import Modal from '@/app/components/base/modal/index'
import Tab, { TypeEnum } from './tab'

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
      className='h-[calc(100vh-32px)] max-w-[calc(100vw-32px)]'
    >
      <Tab
        value={type}
        onChange={setType}
      />
      {appId}
    </Modal>
  )
}
export default React.memo(TryApp)
