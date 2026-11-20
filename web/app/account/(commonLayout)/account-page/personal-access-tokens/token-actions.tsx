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
  deleteDialogHandle,
  formDialogHandle,
}: {
  token: PersonalAccessTokenResponse
  deleteDialogHandle: AlertDialogHandle<PersonalAccessTokenResponse>
  formDialogHandle: DialogHandle<SavedTokenFormPayload>
}) {
  const { t } = useTranslation(['common'])
  return (
    <div className="flex items-center justify-end gap-1">
      <DialogTrigger
        handle={formDialogHandle}
        payload={{ tokenId: token.id, duplicate: false }}
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
        render={
          <IconButton aria-label={t(($) => $['operation.duplicate'])} size="sm">
            <span aria-hidden="true" className="i-ri-file-copy-line size-4" />
          </IconButton>
        }
      />
      <AlertDialogTrigger
        handle={deleteDialogHandle}
        payload={token}
        render={
          <IconButton size="sm" tone="destructive" aria-label={t(($) => $['operation.delete'])}>
            <span aria-hidden="true" className="i-ri-delete-bin-line size-4" />
          </IconButton>
        }
      />
    </div>
  )
}
