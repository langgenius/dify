import type { AccessPolicy } from '@dify/contracts/api/console/workspaces/types.gen'
import type { AlertDialogHandle } from '@langgenius/dify-ui/alert-dialog'
import type { RefObject } from 'react'
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { getErrorMessage } from '@/utils/error-message'

const deletePolicy = consoleQuery.workspaces.current.rbac.accessPolicies.byPolicyId.delete

export function DeleteAccessRuleDialog({
  handle,
  canDeleteRule,
  fallbackFocusRef,
  onDeleted,
}: {
  handle: AlertDialogHandle<AccessPolicy>
  canDeleteRule: (id: string) => boolean
  fallbackFocusRef: RefObject<HTMLButtonElement | null>
  onDeleted: (id: string) => void
}) {
  const { t } = useTranslation(['common', 'permission'])
  const client = useQueryClient()
  const dialogId = useId()
  const mutationKey = [...deletePolicy.mutationKey(), dialogId]
  const filter = { mutationKey, exact: true }
  const deletion = useMutation({
    ...deletePolicy.mutationOptions({
      context: { silent: true },
      networkMode: 'always',
      onSuccess: (_result, { params }) => {
        onDeleted(params.policy_id)
        handle.close()
      },
    }),
    mutationKey,
  })

  return (
    <AlertDialog
      handle={handle}
      onOpenChange={(open, details) => {
        if (open) deletion.reset()
        else if (details.reason !== 'imperative-action' && client.isMutating(filter))
          details.cancel()
      }}
    >
      {({ payload: rule }) =>
        rule && (
          <AlertDialogContent
            backdropProps={{ forceRender: true }}
            finalFocus={() => (canDeleteRule(rule.id) ? true : fallbackFocusRef.current)}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t(($) => $['accessRule.deleteTitle'], { ns: 'permission', name: rule.name })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t(($) => $['accessRule.deleteDescription'], { ns: 'permission' })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {deletion.isError && (
              <AlertDialogBody>
                <p role="alert" className="text-text-destructive">
                  {getErrorMessage(deletion.error) ?? t(($) => $['api.actionFailed'])}
                </p>
              </AlertDialogBody>
            )}
            <AlertDialogFooter>
              <AlertDialogCancelButton disabled={deletion.isPending}>
                {t(($) => $['operation.cancel'])}
              </AlertDialogCancelButton>
              <AlertDialogConfirmButton
                disabled={!canDeleteRule(rule.id)}
                loading={deletion.isPending}
                onClick={() => {
                  if (!handle.isOpen || !canDeleteRule(rule.id) || client.isMutating(filter)) return
                  deletion.mutate({ params: { policy_id: rule.id } })
                }}
              >
                {t(($) => $['operation.delete'])}
              </AlertDialogConfirmButton>
            </AlertDialogFooter>
          </AlertDialogContent>
        )
      }
    </AlertDialog>
  )
}
