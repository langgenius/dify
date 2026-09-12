'use client'

import type { NetworkAccessGroupResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { consoleQuery } from '@/service/console'
import { PolicyReferencedApps } from './referenced-apps'

export const policyRowClassName = 'flex items-center pl-3 pr-1'
export const policyNameColClassName = 'min-w-0 flex-1 truncate'
export const policyIpEntriesColClassName = 'w-30 shrink-0'
export const policyEnforcingColClassName = 'w-32 shrink-0'
export const policyUpdatedColClassName = 'w-52 shrink-0'
export const policyActionsColClassName = 'flex w-8 shrink-0 items-center justify-center'

type PolicyItemProps = {
  group: NetworkAccessGroupResponse
  canMutate: boolean
  onEdit: (group: NetworkAccessGroupResponse) => void
}

export function PolicyItem({ group, canMutate, onEdit }: PolicyItemProps) {
  const { t } = useTranslation()
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const deleteGroup = useMutation(
    consoleQuery.workspaces.current.networkAccessGroups.byGroupId.delete.mutationOptions(),
  )
  const isBound = group.used_by_count > 0
  const enforcingLabel =
    group.used_by_count <= 0
      ? t(($) => $['settings.ipPolicyEnforcingNone'], { ns: 'common' })
      : group.used_by_count === 1
        ? t(($) => $['settings.ipPolicyEnforcingOne'], { ns: 'common' })
        : t(($) => $['settings.ipPolicyEnforcingMany'], {
            ns: 'common',
            count: group.used_by_count,
          })

  const handleDelete = () => {
    if (!canMutate) return

    deleteGroup.mutate(
      {
        params: { group_id: group.id },
        query: { expected_version: group.version },
      },
      {
        onSuccess: () => {
          setConfirmDelete(false)
        },
      },
    )
  }

  return (
    <div className={`${policyRowClassName} border-b border-divider-subtle py-3`}>
      <p className={`${policyNameColClassName} system-sm-medium text-text-secondary`}>
        {group.name}
      </p>
      <p className={`${policyIpEntriesColClassName} system-sm-regular text-text-tertiary`}>
        {group.allowed_cidrs.length}
      </p>
      <p className={`${policyEnforcingColClassName} system-sm-regular text-text-tertiary`}>
        {enforcingLabel}
      </p>
      <p className={`${policyUpdatedColClassName} system-sm-regular text-text-tertiary`}>
        {formatTimeFromNow(Date.parse(group.updated_at))}
      </p>
      <div className={policyActionsColClassName}>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger
            render={
              <IconButton
                size="md"
                aria-label={t(($) => $['operation.moreActionsFor'], {
                  ns: 'common',
                  name: group.name,
                })}
                className="data-popup-open:bg-state-base-hover"
              >
                <span aria-hidden className="i-ri-more-fill size-4 text-text-tertiary" />
              </IconButton>
            }
          />
          <DropdownMenuContent placement="bottom-end" sideOffset={4} className="min-w-35">
            <DropdownMenuItem
              disabled={!canMutate}
              className="system-sm-semibold text-text-secondary"
              onClick={() => {
                if (!canMutate) return
                onEdit(group)
              }}
            >
              {t(($) => $['operation.edit'], { ns: 'common' })}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!canMutate}
              variant="destructive"
              className="system-sm-semibold"
              onClick={() => {
                if (!canMutate) return
                setConfirmDelete(true)
                setMenuOpen(false)
              }}
            >
              {t(($) => $['operation.delete'], { ns: 'common' })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent backdropProps={{ forceRender: true }} className="w-100">
          <div className="flex flex-col gap-2 p-6 pb-4">
            <AlertDialogTitle className="title-xl-semi-bold text-text-primary">
              {t(($) => $['settings.ipPolicyDeleteConfirm'], { ns: 'common', name: group.name })}
            </AlertDialogTitle>
            <AlertDialogDescription className="system-sm-regular text-text-secondary">
              {isBound
                ? t(($) => $['settings.ipPolicyDeleteBoundDescription'], {
                    ns: 'common',
                    name: group.name,
                    count: group.used_by_count,
                  })
                : t(($) => $['settings.ipPolicyDeleteDescription'], { ns: 'common' })}
            </AlertDialogDescription>
            {isBound && (
              <PolicyReferencedApps apps={group.apps} usedByCount={group.used_by_count} />
            )}
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton variant="secondary">
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              disabled={!canMutate || deleteGroup.isPending}
              onClick={handleDelete}
            >
              {t(($) => $['operation.delete'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
