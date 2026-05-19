import type { ApiBasedExtensionResponse } from '@dify/contracts/api/console/api-based-extension/types.gen'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { deleteApiBasedExtension } from '@/service/common'

type ItemProps = {
  data: ApiBasedExtensionResponse
  onEdit: (extension: ApiBasedExtensionResponse) => void
  onUpdate: () => void
}
const Item = ({
  data,
  onEdit,
  onUpdate,
}: ItemProps) => {
  const { t } = useTranslation()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const handleOpenApiBasedExtensionModal = () => {
    onEdit(data)
  }
  const handleDeleteApiBasedExtension = async () => {
    await deleteApiBasedExtension(`/api-based-extension/${data.id}`)

    setShowDeleteConfirm(false)
    onUpdate()
  }

  return (
    <div className="group mb-2 flex items-center rounded-xl border-[0.5px] border-transparent bg-components-input-bg-normal px-4 py-2 focus-within:border-components-input-border-active focus-within:shadow-xs hover:border-components-input-border-active hover:shadow-xs">
      <div className="min-w-0 grow">
        <div className="mb-0.5 text-[13px] font-medium text-text-secondary">{data.name}</div>
        <div className="truncate text-xs text-text-tertiary">{data.api_endpoint}</div>
      </div>
      <div className="pointer-events-none flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
        <Button
          onClick={handleOpenApiBasedExtensionModal}
        >
          <span className="mr-1 i-ri-edit-line h-4 w-4" aria-hidden="true" />
          {t('operation.edit', { ns: 'common' })}
        </Button>
        <Button
          onClick={() => setShowDeleteConfirm(true)}
        >
          <span className="mr-1 i-ri-delete-bin-line h-4 w-4" aria-hidden="true" />
          {t('operation.delete', { ns: 'common' })}
        </Button>
      </div>
      <AlertDialog open={showDeleteConfirm} onOpenChange={open => !open && setShowDeleteConfirm(false)}>
        <AlertDialogContent backdropProps={{ forceRender: true }}>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {`${t('operation.delete', { ns: 'common' })} \u201C${data.name}\u201D?`}
            </AlertDialogTitle>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>{t('operation.cancel', { ns: 'common' })}</AlertDialogCancelButton>
            <AlertDialogConfirmButton onClick={handleDeleteApiBasedExtension}>
              {t('operation.delete', { ns: 'common' }) || ''}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default Item
