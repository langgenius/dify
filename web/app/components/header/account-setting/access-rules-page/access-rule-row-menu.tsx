'use client'

import type { AccessPolicy } from '@dify/contracts/api/console/workspaces/types.gen'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useMutation } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'

type AccessRuleRowMenuProps = {
  rule: AccessPolicy
  onView?: () => void
  onEdit?: () => void
}

const AccessRuleRowMenu = ({ rule, onView, onEdit }: AccessRuleRowMenuProps) => {
  const { t } = useTranslation(['common', 'permission'])
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const { mutate: copyAccessRule } = useMutation(
    consoleQuery.workspaces.current.rbac.accessPolicies.byPolicyId.copy.post.mutationOptions(),
  )
  const { mutate: deleteAccessRule, isPending: isDeletingAccessRule } = useMutation(
    consoleQuery.workspaces.current.rbac.accessPolicies.byPolicyId.delete.mutationOptions(),
  )

  const handleView = useCallback(() => {
    onView?.()
  }, [onView])

  const handleCopyRules = useCallback(() => {
    copyAccessRule(
      { params: { policy_id: rule.id } },
      {
        onSuccess: () => {
          toast.success(t(($) => $['accessRule.copied'], { ns: 'permission' }))
        },
      },
    )
  }, [copyAccessRule, rule.id, t])

  const openDeleteConfirm = useCallback(() => {
    setShowDeleteConfirm(true)
  }, [])

  const handleDelete = useCallback(() => {
    deleteAccessRule(
      { params: { policy_id: rule.id } },
      {
        onSuccess: () => {
          setShowDeleteConfirm(false)
        },
      },
    )
  }, [deleteAccessRule, rule.id])

  const isBuiltIn = rule.is_builtin

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <IconButton
              size="lg"
              aria-label={t(($) => $['operation.moreActions'], { ns: 'common' })}
              className="data-popup-open:bg-state-base-hover"
            >
              <span aria-hidden className="i-ri-more-fill h-4 w-4 text-text-tertiary" />
            </IconButton>
          }
        />
        <DropdownMenuContent side="bottom" align="end" sideOffset={4} className="min-w-35">
          {isBuiltIn ? (
            <DropdownMenuItem
              className="system-sm-semibold text-text-secondary"
              onClick={handleView}
            >
              {t(($) => $['operation.view'], { ns: 'common' })}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem className="system-sm-semibold text-text-secondary" onClick={onEdit}>
              {t(($) => $['operation.edit'], { ns: 'common' })}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            className="system-sm-semibold text-text-secondary"
            onClick={handleCopyRules}
          >
            {t(($) => $['common.duplicateAction'], { ns: 'permission' })}
          </DropdownMenuItem>
          {!isBuiltIn && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                className="system-sm-semibold"
                onClick={openDeleteConfirm}
              >
                {t(($) => $['operation.delete'], { ns: 'common' })}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog
        open={showDeleteConfirm}
        onOpenChange={(open) => !open && setShowDeleteConfirm(false)}
      >
        <AlertDialogContent backdropProps={{ forceRender: true }}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $['accessRule.deleteTitle'], { ns: 'permission', name: rule.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $['accessRule.deleteDescription'], { ns: 'permission' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton disabled={isDeletingAccessRule} onClick={handleDelete}>
              {t(($) => $['operation.delete'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default AccessRuleRowMenu
