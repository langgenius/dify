import type { ApiBasedExtensionResponse } from '@dify/contracts/api/console/api-based-extension/types.gen'
import type { AlertDialogActions } from '@langgenius/dify-ui/alert-dialog'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { useMutation } from '@tanstack/react-query'
import { useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'

type ItemProps = {
  apiBasedExtension: ApiBasedExtensionResponse
  onEdit: (apiBasedExtension: ApiBasedExtensionResponse) => void
  canManage?: boolean
}
export function Item({ apiBasedExtension, onEdit, canManage = true }: ItemProps) {
  const { t } = useTranslation(['common'])
  const nameId = useId()
  const editLabelId = useId()
  const deleteLabelId = useId()
  const actionsRef = useRef<AlertDialogActions>(null)
  const deleteApiBasedExtensionMutation = useMutation(
    consoleQuery.apiBasedExtension.byId.delete.mutationOptions(),
  )

  const handleOpenApiBasedExtensionModal = () => {
    if (!canManage) return

    onEdit(apiBasedExtension)
  }
  const handleDeleteApiBasedExtension = () => {
    if (!canManage) return

    deleteApiBasedExtensionMutation.mutate(
      {
        params: {
          id: apiBasedExtension.id,
        },
      },
      {
        onSuccess: () => actionsRef.current?.close(),
      },
    )
  }

  return (
    <div className="group mb-2 flex items-center rounded-xl border-[0.5px] border-transparent bg-components-input-bg-normal px-4 py-2 focus-within:border-components-input-border-active focus-within:shadow-xs hover:border-components-input-border-active hover:shadow-xs">
      <div className="min-w-0 grow">
        <div id={nameId} className="mb-0.5 text-[13px] font-medium text-text-secondary">
          {apiBasedExtension.name}
        </div>
        <div className="truncate text-xs text-text-tertiary">{apiBasedExtension.api_endpoint}</div>
      </div>
      <div className="pointer-events-none flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
        <Button
          aria-labelledby={`${editLabelId} ${nameId}`}
          disabled={!canManage}
          onClick={handleOpenApiBasedExtensionModal}
        >
          <span className="i-ri-edit-line size-4" aria-hidden="true" />
          <span id={editLabelId}>{t(($) => $['operation.edit'], { ns: 'common' })}</span>
        </Button>
        <AlertDialog actionsRef={actionsRef}>
          <AlertDialogTrigger
            aria-labelledby={`${deleteLabelId} ${nameId}`}
            disabled={!canManage}
            render={<Button />}
          >
            <span className="i-ri-delete-bin-line size-4" aria-hidden="true" />
            <span id={deleteLabelId}>{t(($) => $['operation.delete'], { ns: 'common' })}</span>
          </AlertDialogTrigger>
          <AlertDialogContent backdropProps={{ forceRender: true }}>
            <AlertDialogHeader>
              <AlertDialogTitle className="truncate">
                {`${t(($) => $['operation.delete'], { ns: 'common' })} \u201C${apiBasedExtension.name}\u201D?`}
              </AlertDialogTitle>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancelButton>
                {t(($) => $['operation.cancel'], { ns: 'common' })}
              </AlertDialogCancelButton>
              <AlertDialogConfirmButton
                disabled={!canManage || deleteApiBasedExtensionMutation.isPending}
                onClick={handleDeleteApiBasedExtension}
              >
                {t(($) => $['operation.delete'], { ns: 'common' }) || ''}
              </AlertDialogConfirmButton>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}
