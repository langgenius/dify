import type { FC } from 'react'
import type { VersionHistory } from '@/types/workflow'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'

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

  return (
    <Modal className="p-0" isShow={isOpen} onClose={onClose}>
      <div className="flex flex-col gap-y-2 p-6 pb-4 ">
        <div className="title-2xl-semi-bold text-text-primary">
          {`${t('common.restore', { ns: 'workflow' })} ${versionInfo.marked_name || t('versionHistory.defaultName', { ns: 'workflow' })}`}
        </div>
        <p className="system-md-regular text-text-secondary">
          {t('versionHistory.restorationTip', { ns: 'workflow' })}
        </p>
      </div>
      <div className="flex items-center justify-end gap-x-2 p-6">
        <Button onClick={onClose}>
          {t('operation.cancel', { ns: 'common' })}
        </Button>
        <Button variant="primary" onClick={onRestore.bind(null, versionInfo)}>
          {t('common.restore', { ns: 'workflow' })}
        </Button>
      </div>
    </Modal>
  )
}

export default RestoreConfirmModal
