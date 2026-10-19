import type { PersonalAccessTokenResponse } from '@dify/contracts/api/console/account/types.gen'
import {
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'

export default function DeleteToken({
  token,
  onClose,
}: {
  token: PersonalAccessTokenResponse
  onClose: () => void
}) {
  const { t } = useTranslation(['accountSettings', 'common'])
  const mutation = useMutation(
    consoleQuery.account.personalAccessTokens.byTokenId.delete.mutationOptions({
      context: { silent: true },
    }),
  )
  return (
    <>
      <IconButton
        aria-label={t(($) => $['operation.close'], { ns: 'common' })}
        className="absolute top-5 right-5"
        onClick={() => onClose()}
      >
        <span aria-hidden="true" className="i-ri-close-line size-4" />
      </IconButton>
      <div className="flex flex-col gap-6 p-6">
        <AlertDialogTitle>
          {t(($) => $['personalAccessToken.deleteTitle'], {
            name: token.name,
            suffix: token.secret_last_four,
          })}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {t(($) => $['personalAccessToken.deleteDescription'])}
        </AlertDialogDescription>
        {mutation.isError && (
          <p role="alert" className="system-xs-regular text-text-warning">
            {t(($) => $['api.actionFailed'], { ns: 'common' })}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <AlertDialogCancelButton>
            {t(($) => $['operation.cancel'], { ns: 'common' })}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton
            loading={mutation.isPending}
            onClick={() =>
              mutation.mutate({ params: { token_id: token.id } }, { onSuccess: () => onClose() })
            }
          >
            {t(($) => $['operation.delete'], { ns: 'common' })}
          </AlertDialogConfirmButton>
        </div>
      </div>
    </>
  )
}
