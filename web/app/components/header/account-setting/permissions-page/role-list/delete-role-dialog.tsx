import type { AlertDialogHandle } from '@langgenius/dify-ui/alert-dialog'
import type { RefObject } from 'react'
import type { Role } from '@/models/access-control'
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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { getErrorMessage } from '@/utils/error-message'

export default function DeleteRoleDialog({
  handle,
  fallbackFocus,
  canManageRoles,
}: {
  handle: AlertDialogHandle<Role>
  fallbackFocus: RefObject<HTMLButtonElement | null>
  canManageRoles: boolean
}) {
  const { t } = useTranslation(['common', 'permission'])
  const queryClient = useQueryClient()
  const finalFocusRef = useRef<HTMLButtonElement>(null)
  const deleteRole = consoleQuery.workspaces.current.rbac.roles.byRoleId.delete
  const deletionFilter = { mutationKey: deleteRole.mutationKey(), exact: true }
  const { mutate, isPending, reset } = useMutation(
    deleteRole.mutationOptions({
      meta: { errorToast: false },
      onSuccess: () => {
        finalFocusRef.current = fallbackFocus.current
        handle.close()
      },
      onError: (error) => {
        toast.error(getErrorMessage(error) ?? t(($) => $['api.actionFailed'], { ns: 'common' }))
      },
    }),
  )
  return (
    <AlertDialog
      handle={handle}
      onOpenChange={(open, details) => {
        if (open) {
          finalFocusRef.current = null
          reset()
        } else if (
          details.reason !== 'imperative-action' &&
          queryClient.isMutating(deletionFilter)
        ) {
          details.cancel()
        }
      }}
    >
      {({ payload: role }) =>
        role && (
          <AlertDialogContent finalFocus={finalFocusRef} backdropProps={{ forceRender: true }}>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t(($) => $['role.deleteTitle'], { ns: 'permission', name: role.name })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t(($) => $['role.deleteDescription'], { ns: 'permission' })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancelButton disabled={isPending}>
                {t(($) => $['operation.cancel'], { ns: 'common' })}
              </AlertDialogCancelButton>
              <AlertDialogConfirmButton
                loading={isPending}
                disabled={!canManageRoles}
                onClick={() => {
                  if (!canManageRoles || queryClient.isMutating(deletionFilter)) return
                  mutate({ params: { role_id: role.id } })
                }}
              >
                {t(($) => $['operation.delete'], { ns: 'common' })}
              </AlertDialogConfirmButton>
            </AlertDialogFooter>
          </AlertDialogContent>
        )
      }
    </AlertDialog>
  )
}
