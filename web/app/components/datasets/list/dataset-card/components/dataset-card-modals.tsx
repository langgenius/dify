import type { DataSet } from '@/models/datasets'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Confirm from '@/app/components/base/confirm'
import RenameDatasetModal from '../../../rename-modal'

type ModalState = {
  showRenameModal: boolean
  showConfirmDelete: boolean
  confirmMessage: string
}

type DatasetCardModalsProps = {
  dataset: DataSet
  modalState: ModalState
  onCloseRename: () => void
  onCloseConfirm: () => void
  onConfirmDelete: () => void
  onSuccess?: () => void
}

const DatasetCardModals = ({
  dataset,
  modalState,
  onCloseRename,
  onCloseConfirm,
  onConfirmDelete,
  onSuccess,
}: DatasetCardModalsProps) => {
  const { t } = useTranslation()

  return (
    <>
      {modalState.showRenameModal && (
        <RenameDatasetModal
          show={modalState.showRenameModal}
          dataset={dataset}
          onClose={onCloseRename}
          onSuccess={onSuccess}
        />
      )}
      {modalState.showConfirmDelete && (
        <Confirm
          title={t('deleteDatasetConfirmTitle', { ns: 'dataset' })}
          content={modalState.confirmMessage}
          isShow={modalState.showConfirmDelete}
          onConfirm={onConfirmDelete}
          onCancel={onCloseConfirm}
        />
      )}
    </>
  )
}

export default React.memo(DatasetCardModals)
