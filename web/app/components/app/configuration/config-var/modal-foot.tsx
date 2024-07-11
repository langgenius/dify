'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'

export type IModalFootProps = {
  onConfirm: () => void
  onCancel: () => void
}

const ModalFoot: FC<IModalFootProps> = ({
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation()
  return (
    <div className='flex justify-end gap-2'>
      <Button onClick={onCancel}>{t('common.operation.cancel')}</Button>
      <Button variant='primary' onClick={onConfirm}>{t('common.operation.save')}</Button>
    </div>
  )
}
export default React.memo(ModalFoot)
