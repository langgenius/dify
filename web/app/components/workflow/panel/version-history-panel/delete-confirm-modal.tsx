import type { FC } from 'react'
import type { VersionHistory } from '@/types/workflow'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'

type DeleteConfirmModalProps = {
  isOpen: boolean
  versionInfo: VersionHistory
  onClose: () => void
  onDelete: (id: string) => void
}

const DeleteConfirmModal: FC<DeleteConfirmModalProps> = ({
  isOpen,
  versionInfo,
  onClose,
  onDelete,
}) => {
  const { t } = useTranslation()

  return (
    <Modal className="p-0" isShow={isOpen} onClose={onClose}>
      <div className="flex flex-col gap-y-2 p-6 pb-4 ">
        <div className="title-2xl-semi-bold text-text-primary">
          {`${t('operation.delete', { ns: 'common' })} ${versionInfo.marked_name || t('versionHistory.defaultName', { ns: 'workflow' })}`}
        </div>
        <p className="system-md-regular text-text-secondary">
          {t('versionHistory.deletionTip', { ns: 'workflow' })}
        </p>
      </div>
      <div className="flex items-center justify-end gap-x-2 p-6">
        <Button onClick={onClose}>
          {t('operation.cancel', { ns: 'common' })}
        </Button>
        <Button variant="warning" onClick={onDelete.bind(null, versionInfo.id)}>
          {t('operation.delete', { ns: 'common' })}
        </Button>
      </div>
    </Modal>
  )
}

export default DeleteConfirmModal
