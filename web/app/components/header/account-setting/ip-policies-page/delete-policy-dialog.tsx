'use client'

import type { NetworkAccessGroupResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { AlertDialogHandle } from '@langgenius/dify-ui/alert-dialog'
import type { RefObject } from 'react'
import type { DeletePolicyPayload } from './policy-dialog-payload'
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
import { DialogClose } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useMutation } from '@tanstack/react-query'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { trackNetworkAccessEvent } from '@/features/network-access/analytics'
import { PolicyReferencedApps } from '@/features/network-access/policy-references'
import { consoleQuery } from '@/service/console'

type DeletePolicyDialogProps = {
  dialog: AlertDialogHandle<DeletePolicyPayload>
  groups: readonly NetworkAccessGroupResponse[]
  fallbackFocus: RefObject<HTMLElement | null>
}

export function DeletePolicyDialog({ dialog, groups, fallbackFocus }: DeletePolicyDialogProps) {
  const { t } = useTranslation(['common'])
  const deleteSucceededRef = useRef(false)
  const deleteGroup = useMutation(
    consoleQuery.workspaces.current.networkAccessGroups.byGroupId.delete.mutationOptions({
      networkMode: 'always',
    }),
  )

  const handleDelete = (group: NetworkAccessGroupResponse) => {
    if (!dialog.isOpen || deleteGroup.isPending) return
    trackNetworkAccessEvent('ip_policy_interaction', {
      action: 'delete_confirmed',
      policy_id: group.id,
      referenced_app_count: group.used_by_count,
    })
    deleteGroup.mutate(
      {
        params: { group_id: group.id },
        query: { expected_version: group.version },
      },
      {
        onSuccess: () => {
          deleteSucceededRef.current = true
          dialog.close()
        },
      },
    )
  }

  return (
    <AlertDialog
      handle={dialog}
      onOpenChange={(open, details) => {
        if (open) deleteSucceededRef.current = false
        else if (deleteGroup.isPending && details.reason !== 'imperative-action') details.cancel()
      }}
    >
      {({ payload }) => {
        if (!payload) return null
        const { opener } = payload
        const currentGroup = groups.find((group) => group.id === payload.group.id)
        // Keep the confirmation visible through exit if the refreshed list removed the row.
        const group = currentGroup ?? payload.group
        const isBound = group.used_by_count > 0
        return (
          <AlertDialogContent
            backdropProps={{ forceRender: true }}
            className="w-120"
            finalFocus={() => {
              // The list can still contain the deleted row when the dialog restores focus.
              return deleteSucceededRef.current || !opener.isConnected
                ? fallbackFocus.current
                : opener
            }}
          >
            <AlertDialogHeader>
              <div className="flex items-start gap-4">
                <div className="min-w-0 flex-1">
                  <AlertDialogTitle>
                    {t(($) => $['settings.ipPolicyDeleteConfirm'], {
                      ns: 'common',
                      name: group.name,
                    })}
                  </AlertDialogTitle>
                </div>
                <DialogClose
                  disabled={deleteGroup.isPending}
                  render={
                    <IconButton
                      size="lg"
                      aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                    >
                      <span aria-hidden className="i-ri-close-line size-4" />
                    </IconButton>
                  }
                />
              </div>
              <AlertDialogDescription>
                {isBound
                  ? t(($) => $['settings.ipPolicyDeleteBoundDescription'], { ns: 'common' })
                  : t(($) => $['settings.ipPolicyDeleteDescription'], { ns: 'common' })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {isBound && (
              <AlertDialogBody>
                <div className="flex flex-col gap-3">
                  <p className="system-sm-medium text-text-secondary">
                    {t(($) => $['settings.ipPolicyUsedBy'], {
                      ns: 'common',
                      count: group.used_by_count,
                    })}
                  </p>
                  {group.apps.length > 0 && (
                    <PolicyReferencedApps apps={group.apps} usedByCount={group.used_by_count} />
                  )}
                </div>
              </AlertDialogBody>
            )}
            <AlertDialogFooter>
              <AlertDialogCancelButton
                variant="secondary"
                disabled={deleteGroup.isPending}
                onClick={() =>
                  trackNetworkAccessEvent('ip_policy_interaction', {
                    action: 'delete_cancelled',
                    policy_id: group.id,
                  })
                }
              >
                {t(($) => $['operation.cancel'], { ns: 'common' })}
              </AlertDialogCancelButton>
              <AlertDialogConfirmButton
                disabled={!currentGroup}
                loading={deleteGroup.isPending}
                onClick={() => {
                  if (currentGroup) handleDelete(currentGroup)
                }}
              >
                {t(($) => $['operation.delete'], { ns: 'common' })}
              </AlertDialogConfirmButton>
            </AlertDialogFooter>
          </AlertDialogContent>
        )
      }}
    </AlertDialog>
  )
}
