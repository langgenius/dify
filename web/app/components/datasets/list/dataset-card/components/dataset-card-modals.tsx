import type { DataSet } from '@/models/datasets'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import dynamic from '@/next/dynamic'
import RenameDatasetModal from '../../../rename-modal'

const DatasetAccessConfigModal = dynamic(() => import('../dataset-access-config-modal'), {
  ssr: false,
})

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
  onCloseAccessConfig,
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
      {modalState.showAccessConfig && (
        <DatasetAccessConfigModal
          open
          dataset={dataset}
          onClose={onCloseAccessConfig}
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
