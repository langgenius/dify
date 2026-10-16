import type { DataSet } from '@/models/datasets'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import RenameDatasetModal from '../../../rename-modal'

type ModalState = {
  showRenameModal: boolean
  showConfirmDelete: boolean
  showAccessConfig: boolean
  confirmMessage: string
}

type DatasetCardModalsProps = {
  dataset: DataSet
  modalState: ModalState
  onCloseRename: () => void
  onCloseConfirm: () => void
  onCloseAccessConfig: () => void
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
  const { t } = useTranslation(['common', 'dataset'])

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
      <AlertDialog
        open={modalState.showConfirmDelete}
        onOpenChange={(open) => !open && onCloseConfirm()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $.deleteDatasetConfirmTitle, { ns: 'dataset' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{modalState.confirmMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton onClick={onConfirmDelete}>
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default React.memo(DatasetCardModals)
