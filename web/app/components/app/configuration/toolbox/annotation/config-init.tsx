'use client'
import type { FC } from 'react'
import React from 'react'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'

type Props = {
  isShow: boolean
  onHide: () => {}
  onSave: (data: any) => {}
}

const ConfigInit: FC<Props> = ({
  isShow,
  onHide,
  onSave,
}) => {
  return (
    <Modal
      isShow={isShow}
      onHide={onHide}

    >
      <div className='flex gap-2 justify-end'>
        <Button onClick={onHide}>{t('common.operation.cancel')}</Button>
        <Button
          type='warning'
          onClick={onRemove}
          className='border-red-700 border-[0.5px]'
        >
          {t('common.operation.sure')}
        </Button>
      </div>
    </Modal>
  )
}
export default React.memo(ConfigInit)
