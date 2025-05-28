'use client'

import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'
import cn from '@/utils/classnames'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import { noop } from 'lodash-es'

type ConfirmModalProps = {
  show: boolean
  onConfirm?: () => void
  onClose: () => void
}

const ConfirmModal = ({ show, onConfirm, onClose }: ConfirmModalProps) => {
  const { t } = useTranslation()

  return (
    <Modal
      className={cn('w-[600px] max-w-[600px] p-8')}
      isShow={show}
      onClose={noop}
    >
      <div className='absolute right-4 top-4 cursor-pointer p-2' onClick={onClose}>
        <RiCloseLine className='h-4 w-4 text-text-tertiary' />
      </div>
      <div className='h-12 w-12 rounded-xl border-[0.5px] border-divider-regular bg-background-section p-3 shadow-xl'>
        <AlertTriangle className='h-6 w-6 text-[rgb(247,144,9)]' />
      </div>
      <div className='relative mt-3 text-xl font-semibold leading-[30px] text-text-primary'>{t('tools.createTool.confirmTitle')}</div>
      <div className='my-1 text-sm leading-5 text-text-tertiary'>
        {t('tools.createTool.confirmTip')}
      </div>
      <div className='flex items-center justify-end pt-6'>
        <div className='flex items-center'>
          <Button className='mr-2' onClick={onClose}>{t('common.operation.cancel')}</Button>
          <Button variant="warning" onClick={onConfirm}>{t('common.operation.confirm')}</Button>
        </div>
      </div>
    </Modal>
  )
}

export default ConfirmModal
