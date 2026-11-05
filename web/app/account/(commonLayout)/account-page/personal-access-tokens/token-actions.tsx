import type { PersonalAccessTokenResponse } from '@dify/contracts/api/console/account/types.gen'
import type { AlertDialogHandle } from '@langgenius/dify-ui/alert-dialog'
import type { DialogHandle } from '@langgenius/dify-ui/dialog'
import type { SavedTokenFormPayload } from './saved-token-form'
import { AlertDialogTrigger } from '@langgenius/dify-ui/alert-dialog'
import { DialogTrigger } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useTranslation } from 'react-i18next'

export default function TokenActions({
  token,
  onDelete,
  deleteDialogHandle,
  formDialogHandle,
  onFormOpen,
}: {
  token: PersonalAccessTokenResponse
  onDelete: (token: PersonalAccessTokenResponse, trigger: HTMLButtonElement) => void
  deleteDialogHandle: AlertDialogHandle
  formDialogHandle: DialogHandle<SavedTokenFormPayload>
  onFormOpen: (trigger: HTMLButtonElement) => void
}) {
  const { t } = useTranslation(['common'])
  return (
    <div className="flex items-center justify-end gap-1">
      <DialogTrigger
        handle={formDialogHandle}
        payload={{ tokenId: token.id, duplicate: false }}
        onClick={(event) => onFormOpen(event.currentTarget)}
        render={
          <IconButton
            aria-label={t(($) => $['operation.edit'])}
            disabled={token.status === 'expired'}
            size="sm"
          >
            <span aria-hidden="true" className="i-ri-edit-line size-4" />
          </IconButton>
        }
      />
      <DialogTrigger
        handle={formDialogHandle}
        payload={{ tokenId: token.id, duplicate: true }}
        onClick={(event) => onFormOpen(event.currentTarget)}
        render={
          <IconButton aria-label={t(($) => $['operation.duplicate'])} size="sm">
            <span aria-hidden="true" className="i-ri-file-copy-line size-4" />
          </IconButton>
        }
      />
      <AlertDialogTrigger
        handle={deleteDialogHandle}
        onClick={(event) => onDelete(token, event.currentTarget)}
        render={
          <IconButton size="sm" tone="destructive" aria-label={t(($) => $['operation.delete'])}>
            <span aria-hidden="true" className="i-ri-delete-bin-line size-4" />
          </IconButton>
        }
      />
    </div>
  )
}
