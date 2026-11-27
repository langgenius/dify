'use client'

import type { NetworkAccessGroupResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { AlertDialogHandle } from '@langgenius/dify-ui/alert-dialog'
import type { DialogHandle } from '@langgenius/dify-ui/dialog'
import type { DeletePolicyPayload, PolicyDialogPayload } from './policy-dialog-payload'
import type { IpPolicyFormContext } from '@/features/network-access/analytics'
import { Button } from '@langgenius/dify-ui/button'
import { DialogTrigger } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@langgenius/dify-ui/menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { trackNetworkAccessEvent } from '@/features/network-access/analytics'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'

export const policyRowClassName = 'flex items-center ps-3 pe-1'
export const policyNameColClassName = 'min-w-0 flex-1 truncate'
export const policyIpEntriesColClassName = 'w-30 shrink-0'
export const policyUsedByColClassName = 'w-32 shrink-0'
export const policyUpdatedColClassName = 'w-52 shrink-0'
export const policyActionsColClassName = 'flex w-8 shrink-0 items-center justify-center'

type PolicyItemProps = {
  group: NetworkAccessGroupResponse
  canMutate: boolean
  policyDialog: DialogHandle<PolicyDialogPayload>
  deleteDialog: AlertDialogHandle<DeletePolicyPayload>
  onFormOpen: (context: IpPolicyFormContext) => void
}

export function PolicyItem({
  group,
  canMutate,
  policyDialog,
  deleteDialog,
  onFormOpen,
}: PolicyItemProps) {
  const { t } = useTranslation(['common'])
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const rowTriggerRef = useRef<HTMLButtonElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const usedByLabel =
    group.used_by_count <= 0
      ? t(($) => $['settings.ipPolicyEnforcingNone'], { ns: 'common' })
      : group.used_by_count === 1
        ? t(($) => $['settings.ipPolicyEnforcingOne'], { ns: 'common' })
        : t(($) => $['settings.ipPolicyEnforcingMany'], {
            ns: 'common',
            count: group.used_by_count,
          })

  return (
    <div
      role="row"
      className={`${policyRowClassName} relative border-b border-divider-subtle py-3 hover:bg-state-base-hover`}
    >
      <div role="cell" className="flex min-w-0 flex-1">
        {/* Extend the name button's hit area across the row without nesting the actions. */}
        <DialogTrigger
          handle={policyDialog}
          payload={{ mode: canMutate ? 'edit' : 'view', group, opener: rowTriggerRef }}
          onClick={() =>
            onFormOpen({
              mode: canMutate ? 'edit' : 'view',
              source: 'list_row',
              policy_id: group.id,
            })
          }
          render={
            <Button
              ref={rowTriggerRef}
              variant="ghost"
              className="h-auto w-full min-w-0 justify-start gap-0 overflow-visible rounded-none p-0 text-start after:absolute after:inset-0 hover:bg-transparent"
            />
          }
        >
          <span className={`${policyNameColClassName} system-sm-medium text-text-secondary`}>
            {group.name}
          </span>
        </DialogTrigger>
      </div>
      <div
        role="cell"
        className={`${policyIpEntriesColClassName} system-sm-regular text-text-tertiary`}
      >
        {group.allowed_cidrs.length}
      </div>
      <div
        role="cell"
        className={`${policyUsedByColClassName} system-sm-regular text-text-tertiary`}
      >
        {usedByLabel}
      </div>
      <div
        role="cell"
        className={`${policyUpdatedColClassName} system-sm-regular text-text-tertiary`}
      >
        {formatTimeFromNow(Date.parse(group.updated_at))}
      </div>
      <div role="cell" className={`${policyActionsColClassName} pointer-events-none relative`}>
        {canMutate && (
          <Menu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <MenuTrigger
                    render={
                      <IconButton
                        ref={menuButtonRef}
                        size="md"
                        aria-label={t(($) => $['operation.moreActionsFor'], {
                          ns: 'common',
                          name: group.name,
                        })}
                        className="pointer-events-auto data-popup-open:bg-state-base-hover"
                      >
                        <span aria-hidden className="i-ri-more-fill size-4 text-text-tertiary" />
                      </IconButton>
                    }
                  />
                }
              />
              <TooltipContent>
                {t(($) => $['settings.ipPolicyMore'], { ns: 'common' })}
              </TooltipContent>
            </Tooltip>
            <MenuContent align="end" className="min-w-35">
              <MenuItem
                className="system-sm-semibold text-text-secondary"
                onClick={() => {
                  onFormOpen({ mode: 'edit', source: 'list_row_menu', policy_id: group.id })
                  policyDialog.openWithPayload({
                    mode: 'edit',
                    group,
                    opener: menuButtonRef,
                  })
                }}
              >
                {t(($) => $['operation.edit'], { ns: 'common' })}
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                variant="destructive"
                className="system-sm-semibold"
                onClick={() => {
                  if (!menuButtonRef.current) return
                  deleteDialog.openWithPayload({ group, opener: menuButtonRef.current })
                  trackNetworkAccessEvent('ip_policy_interaction', {
                    action: 'delete_attempted',
                    policy_id: group.id,
                  })
                }}
              >
                {t(($) => $['operation.delete'], { ns: 'common' })}
              </MenuItem>
            </MenuContent>
          </Menu>
        )}
      </div>
    </div>
  )
}
