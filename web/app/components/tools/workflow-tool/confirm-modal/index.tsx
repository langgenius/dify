'use client'

import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'
import cn from '@/utils/classnames'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'

type ConfirmModalProps = {
  show: boolean
  onConfirm?: () => void
  onClose: () => void
}

const ConfirmModal = ({ show, onConfirm, onClose }: ConfirmModalProps) => {
  const { t } = useTranslation()

  return (
    <Modal
      className={cn('p-8 max-w-[600px] w-[600px]')}
      isShow={show}
      onClose={() => { }}
    >
      <div className='absolute right-4 top-4 p-2 cursor-pointer' onClick={onClose}>
        <RiCloseLine className='w-4 h-4 text-text-tertiary' />
      </div>
      <div className='w-12 h-12 p-3 bg-background-section rounded-xl border-[0.5px] border-divider-regular shadow-xl'>
        <AlertTriangle className='w-6 h-6 text-[rgb(247,144,9)]' />
      </div>
      <div className='relative mt-3 text-xl font-semibold leading-[30px] text-text-primary'>{t('tools.createTool.confirmTitle')}</div>
      <div className='my-1 text-text-tertiary text-sm leading-5'>
        {t('tools.createTool.confirmTip')}
      </div>
      <div className='pt-6 flex justify-end items-center'>
        <div className='flex items-center'>
          <Button className='mr-2' onClick={onClose}>{t('common.operation.cancel')}</Button>
          <Button variant="warning" onClick={onConfirm}>{t('common.operation.confirm')}</Button>
        </div>
      </div>
    </Modal>
  )
}

export default ConfirmModal
