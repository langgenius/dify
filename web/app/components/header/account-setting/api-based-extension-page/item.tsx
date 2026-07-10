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
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'

type ItemProps = {
  apiBasedExtension: ApiBasedExtensionResponse
  onEdit: (apiBasedExtension: ApiBasedExtensionResponse) => void
  canManage?: boolean
}
export function Item({
  apiBasedExtension,
  onEdit,
  canManage = true,
}: ItemProps) {
  const { t } = useTranslation()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const deleteApiBasedExtensionMutation = useMutation(consoleQuery.apiBasedExtension.byId.delete.mutationOptions())

  const handleOpenApiBasedExtensionModal = () => {
    if (!canManage)
      return

    onEdit(apiBasedExtension)
  }
  const handleDeleteApiBasedExtension = () => {
    if (!canManage)
      return

    deleteApiBasedExtensionMutation.mutate({
      params: {
        id: apiBasedExtension.id,
      },
    }, {
      onSuccess: () => {
        setShowDeleteConfirm(false)
      },
    })
  }

  return (
    <div className="group mb-2 flex items-center rounded-xl border-[0.5px] border-transparent bg-components-input-bg-normal px-4 py-2 focus-within:border-components-input-border-active focus-within:shadow-xs hover:border-components-input-border-active hover:shadow-xs">
      <div className="min-w-0 grow">
        <div className="mb-0.5 text-[13px] font-medium text-text-secondary">{apiBasedExtension.name}</div>
        <div className="truncate text-xs text-text-tertiary">{apiBasedExtension.api_endpoint}</div>
      </div>
      <div className="pointer-events-none flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
        <Button
          disabled={!canManage}
          onClick={handleOpenApiBasedExtensionModal}
        >
          <span className="mr-1 i-ri-edit-line size-4" aria-hidden="true" />
          {t($ => $['operation.edit'], { ns: 'common' })}
        </Button>
        <Button
          disabled={!canManage}
          onClick={() => canManage && setShowDeleteConfirm(true)}
        >
          <span className="mr-1 i-ri-delete-bin-line size-4" aria-hidden="true" />
          {t($ => $['operation.delete'], { ns: 'common' })}
        </Button>
      </div>
      <AlertDialog open={showDeleteConfirm} onOpenChange={open => !open && setShowDeleteConfirm(false)}>
        <AlertDialogContent backdropProps={{ forceRender: true }}>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {`${t($ => $['operation.delete'], { ns: 'common' })} \u201C${apiBasedExtension.name}\u201D?`}
            </AlertDialogTitle>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>{t($ => $['operation.cancel'], { ns: 'common' })}</AlertDialogCancelButton>
            <AlertDialogConfirmButton
              disabled={!canManage || deleteApiBasedExtensionMutation.isPending}
              onClick={handleDeleteApiBasedExtension}
            >
              {t($ => $['operation.delete'], { ns: 'common' }) || ''}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
