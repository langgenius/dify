'use client'

import { RiCloseLine } from '@remixicon/react'
import { noop } from 'es-toolkit/function'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import Modal from '@/app/components/base/modal'
import { cn } from '@/utils/classnames'

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
      <div className="absolute right-4 top-4 cursor-pointer p-2" onClick={onClose}>
        <RiCloseLine className="h-4 w-4 text-text-tertiary" />
      </div>
      <div className="h-12 w-12 rounded-xl border-[0.5px] border-divider-regular bg-background-section p-3 shadow-xl">
        <AlertTriangle className="h-6 w-6 text-[rgb(247,144,9)]" />
      </div>
      <div className="relative mt-3 text-xl font-semibold leading-[30px] text-text-primary">{t('createTool.confirmTitle', { ns: 'tools' })}</div>
      <div className="my-1 text-sm leading-5 text-text-tertiary">
        {t('createTool.confirmTip', { ns: 'tools' })}
      </div>
      <div className="flex items-center justify-end pt-6">
        <div className="flex items-center">
          <Button className="mr-2" onClick={onClose}>{t('operation.cancel', { ns: 'common' })}</Button>
          <Button variant="warning" onClick={onConfirm}>{t('operation.confirm', { ns: 'common' })}</Button>
        </div>
      </div>
    </Modal>
  )
}

export default ConfirmModal
