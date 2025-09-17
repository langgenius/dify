'use client'
import { useTranslation } from 'react-i18next'
import { RiLogoutBoxRLine } from '@remixicon/react'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'

type LogoutModalProps = {
  isShow: boolean
  source?: string
  onConfirm: () => void
  onCancel: () => void
}

const LogoutModal = ({ isShow, source, onConfirm, onCancel }: LogoutModalProps) => {
  const { t } = useTranslation()

  return (
    <Modal
      isShow={isShow}
      onClose={onCancel}
      className='!w-[420px] !p-0'
    >
      <div className='p-6'>
        <div className='mb-4 flex items-center gap-3'>
          <div className='bg-background-warning-subtle flex h-12 w-12 items-center justify-center rounded-xl'>
            <RiLogoutBoxRLine className='h-6 w-6 text-text-warning' />
          </div>
          <div>
            <h3 className='title-lg-semi-bold text-text-primary'>
              {t('common.logout.confirmTitle')}
            </h3>
          </div>
        </div>

        <p className='body-md-regular mb-6 text-text-secondary'>
          {t('common.logout.confirmMessage')}
        </p>

        <div className='flex gap-2'>
          <Button
            className='flex-1'
            variant='secondary'
            onClick={onCancel}
          >
            {t('common.operation.cancel')}
          </Button>
          <Button
            className='flex-1'
            variant='warning'
            onClick={onConfirm}
          >
            {t('common.logout.confirmButton')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default LogoutModal
