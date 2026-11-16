import type { PersonalAccessTokenResponse } from '@dify/contracts/api/console/account/types.gen'
import type { AlertDialogHandle } from '@langgenius/dify-ui/alert-dialog'
import type { RefObject } from 'react'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useMutation } from '@tanstack/react-query'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'

export default function DeleteToken({
  handle,
  fallbackFocus,
}: {
  handle: AlertDialogHandle<PersonalAccessTokenResponse>
  fallbackFocus: RefObject<HTMLButtonElement | null>
}) {
  const triggerRef = useRef<Element | null>(null)
  const { t } = useTranslation(['accountSettings', 'common'])
  const mutation = useMutation(
    consoleQuery.account.personalAccessTokens.byTokenId.delete.mutationOptions({
      context: { silent: true },
    }),
  )
  return (
    <AlertDialog
      handle={handle}
      onOpenChange={(open, details) => {
        if (open) {
          triggerRef.current = details.trigger ?? null
          mutation.reset()
        } else if (mutation.isPending && details.reason !== 'imperative-action') {
          details.cancel()
        }
      }}
    >
      {({ payload: token }) =>
        token && (
          <AlertDialogContent
            className="w-110"
            finalFocus={() =>
              triggerRef.current instanceof HTMLElement && triggerRef.current.isConnected
                ? triggerRef.current
                : fallbackFocus.current
            }
          >
            <IconButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              className="absolute inset-e-5 top-5"
              disabled={mutation.isPending}
              onClick={() => handle.close()}
            >
              <span aria-hidden="true" className="i-ri-close-line size-4" />
            </IconButton>
            <div className="flex flex-col gap-6 p-6">
              <div className="pe-8">
                <AlertDialogTitle>
                  {t(($) => $['personalAccessToken.deleteTitle'], {
                    name: token.name,
                    suffix: token.secret_last_four,
                  })}
                </AlertDialogTitle>
              </div>
              <AlertDialogDescription>
                {t(($) => $['personalAccessToken.deleteDescription'])}
              </AlertDialogDescription>
              {mutation.isError && (
                <p role="alert" className="system-xs-regular text-text-warning">
                  {t(($) => $['api.actionFailed'], { ns: 'common' })}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <AlertDialogCancelButton disabled={mutation.isPending}>
                  {t(($) => $['operation.cancel'], { ns: 'common' })}
                </AlertDialogCancelButton>
                <AlertDialogConfirmButton
                  loading={mutation.isPending}
                  onClick={() => {
                    if (mutation.isPending) return
                    mutation.mutate(
                      { params: { token_id: token.id } },
                      {
                        onSuccess: () => {
                          triggerRef.current = null
                          handle.close()
                        },
                      },
                    )
                  }}
                >
                  {t(($) => $['operation.delete'], { ns: 'common' })}
                </AlertDialogConfirmButton>
              </div>
            </div>
          </AlertDialogContent>
        )
      }
    </AlertDialog>
  )
}
