'use client'
import React, { useState } from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'
import Modal from '@/app/components/base/modal'
import Checkbox from '@/app/components/base/checkbox'
import Button from '@/app/components/base/button'
// import Toast from '@/app/components/base/toast'

export type DSLExportConfirmModalProps = {
  show: boolean
  onConfirm: () => void
  onClose: () => void
}

const DSLExportConfirmModal = ({
  show = false,
  onConfirm,
  onClose,
}: DSLExportConfirmModalProps) => {
  const { t } = useTranslation()

  const [exportSecrets, setExportSecrets] = useState<boolean>(false)

  const submit = () => {
    onConfirm()
    onClose()
  }

  return (
    <Modal
      isShow={show}
      onClose={() => { }}
      className={cn('max-w-[480px] w-[480px]')}
    >
      <div className='relative pb-2 text-xl font-medium leading-[30px] text-gray-900'>{t('workflow.env.export.title')}</div>
      <div className='absolute right-6 top-6 p-2 cursor-pointer' onClick={onClose}>
        <RiCloseLine className='w-4 h-4 text-gray-500' />
      </div>
      <div className=''>
      </div>
      <div className='mt-4 flex gap-2'>
        <Checkbox
          className='shrink-0'
          checked={exportSecrets}
          onCheck={() => setExportSecrets(!exportSecrets)}
        />
        <div className='text-gray-700 text-xs font-medium' onClick={() => setExportSecrets(!exportSecrets)}>{t('workflow.env.export.checkbox')}</div>
      </div>
      <div className='flex flex-row-reverse'>
        {!exportSecrets && (
          <Button className='ml-2' variant='primary' onClick={submit}>{t('workflow.env.export.ignore')}</Button>
        )}
        {exportSecrets && (
          <Button className='ml-2' variant='warning' onClick={submit}>{t('workflow.env.export.export')}</Button>
        )}
        <Button onClick={onClose}>{t('common.operation.cancel')}</Button>
      </div>
    </Modal>
  )
}

export default DSLExportConfirmModal
