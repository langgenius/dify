import type { DataSet } from '@/models/datasets'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/app/components/base/ui/alert-dialog'
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
      <AlertDialog open={modalState.showConfirmDelete} onOpenChange={open => !open && onCloseConfirm()}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t('deleteDatasetConfirmTitle', { ns: 'dataset' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {modalState.confirmMessage}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>
              {t('operation.cancel', { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton onClick={onConfirmDelete}>
              {t('operation.confirm', { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default React.memo(DatasetCardModals)
