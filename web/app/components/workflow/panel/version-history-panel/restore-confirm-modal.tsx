import React, { type FC } from 'react'
import Modal from '@/app/components/base/modal'
import type { VersionHistory } from '@/types/workflow'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'

type RestoreConfirmModalProps = {
  isOpen: boolean
  versionInfo: VersionHistory
  onClose: () => void
  onRestore: (item: VersionHistory) => void
}

const RestoreConfirmModal: FC<RestoreConfirmModalProps> = ({
  isOpen,
  versionInfo,
  onClose,
  onRestore,
}) => {
  const { t } = useTranslation()

  return <Modal className='p-0' isShow={isOpen} onClose={onClose}>
    <div className='flex flex-col gap-y-2 p-6 pb-4 '>
      <div className='title-2xl-semi-bold text-text-primary'>
        {`${t('workflow.common.restore')} ${versionInfo.marked_name || t('workflow.versionHistory.defaultName')}`}
      </div>
      <p className='system-md-regular text-text-secondary'>
        {t('workflow.versionHistory.restorationTip')}
      </p>
    </div>
    <div className='flex items-center justify-end gap-x-2 p-6'>
      <Button onClick={onClose}>
        {t('common.operation.cancel')}
      </Button>
      <Button variant='primary' onClick={onRestore.bind(null, versionInfo)}>
        {t('workflow.common.restore')}
      </Button>
    </div>
  </Modal>
}

export default RestoreConfirmModal
