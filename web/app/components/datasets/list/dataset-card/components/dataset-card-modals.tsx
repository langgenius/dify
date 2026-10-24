import type { DatasetCardItem } from '../types'
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
  dataset: DatasetCardItem
  modalState: ModalState
  onCloseRename: () => void
  onCloseConfirm: () => void
  onCloseAccessConfig: () => void
  onConfirmDelete: () => void
  isDeleting: boolean
  onSuccess?: () => void
}

const DatasetCardModals = ({
  dataset,
  modalState,
  onCloseRename,
  onCloseConfirm,
  onConfirmDelete,
  isDeleting,
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
        onOpenChange={(open, details) => {
          if (!open && isDeleting) {
            details.cancel()
            return
          }
          if (!open) onCloseConfirm()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $.deleteDatasetConfirmTitle, { ns: 'dataset' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{modalState.confirmMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton disabled={isDeleting}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton loading={isDeleting} onClick={onConfirmDelete}>
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default React.memo(DatasetCardModals)
