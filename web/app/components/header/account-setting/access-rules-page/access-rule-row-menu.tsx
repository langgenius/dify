'use client'

import type { AccessPolicy } from '@/models/access-control'
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
import { toast } from '@langgenius/dify-ui/toast'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import {
  useCopyAccessRule,
  useDeleteAccessRule,
} from '@/service/access-control/use-workspace-access-rules'

type AccessRuleRowMenuProps = {
  rule: AccessPolicy
  onView?: () => void
  onEdit?: () => void
}

const AccessRuleRowMenu = ({ rule, onView, onEdit }: AccessRuleRowMenuProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const { mutateAsync: copyAccessRule } = useCopyAccessRule(rule.resource_type)
  const { mutateAsync: deleteAccessRule, isPending: isDeletingAccessRule } = useDeleteAccessRule(
    rule.resource_type,
  )

  const handleView = useCallback(() => {
    onView?.()
  }, [onView])

  const handleCopyRules = useCallback(() => {
    copyAccessRule(rule.id, {
      onSuccess: () => {
        toast.success(t(($) => $['accessRule.copied'], { ns: 'permission' }))
        setOpen(false)
      },
    })
  }, [copyAccessRule, rule.id, t])

  const openDeleteConfirm = useCallback(() => {
    setShowDeleteConfirm(true)
    setOpen(false)
  }, [])

  const handleDelete = useCallback(() => {
    deleteAccessRule(rule.id, {
      onSuccess: () => {
        toast.success(t(($) => $['accessRule.deleted'], { ns: 'permission' }))
        setShowDeleteConfirm(false)
      },
    })
  }, [deleteAccessRule, rule.id, t])

  const isBuiltIn = rule.is_builtin

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          render={
            <ActionButton
              size="l"
              className={open ? 'bg-state-base-hover' : ''}
              aria-label={t(($) => $['operation.moreActions'], { ns: 'common' })}
            />
          }
        >
          <span aria-hidden className="i-ri-more-fill h-4 w-4 text-text-tertiary" />
        </DropdownMenuTrigger>
        <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="min-w-[140px]">
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
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t(($) => $['accessRule.deleteTitle'], { ns: 'permission', name: rule.name })}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {t(($) => $['accessRule.deleteDescription'], { ns: 'permission' })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton disabled={isDeletingAccessRule} onClick={handleDelete}>
              {t(($) => $['operation.delete'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default AccessRuleRowMenu
