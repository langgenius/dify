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
import ActionButton from '@/app/components/base/action-button'
import { useCopyAccessRule, useDeleteAccessRule } from '@/service/access-control/use-workspace-access-rules'

export type AccessRuleRowMenuProps = {
  rule: AccessPolicy
  onView?: () => void
  onEdit?: () => void
}

const AccessRuleRowMenu = ({
  rule,
  onView,
  onEdit,
}: AccessRuleRowMenuProps) => {
  const [open, setOpen] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const { mutateAsync: copyAccessRule } = useCopyAccessRule(rule.resource_type)
  const { mutateAsync: deleteAccessRule, isPending: isDeletingAccessRule } = useDeleteAccessRule(rule.resource_type)

  const handleView = useCallback(() => {
    onView?.()
  }, [onView])

  const handleCopyRules = useCallback(() => {
    copyAccessRule(rule.id, {
      onSuccess: () => {
        toast.success('Access rule copied successfully')
        setOpen(false)
      },
    })
  }, [copyAccessRule, rule.id])

  const openDeleteConfirm = useCallback(() => {
    setShowDeleteConfirm(true)
    setOpen(false)
  }, [])

  const handleDelete = useCallback(() => {
    deleteAccessRule(rule.id, {
      onSuccess: () => {
        toast.success('Access rule deleted successfully')
        setShowDeleteConfirm(false)
      },
    })
  }, [deleteAccessRule, rule.id])

  const isBuiltIn = rule.is_builtin

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          render={(
            <ActionButton
              size="l"
              className={open ? 'bg-state-base-hover' : ''}
              aria-label="More actions"
            />
          )}
        >
          <span aria-hidden className="i-ri-more-fill h-4 w-4 text-text-tertiary" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          placement="bottom-end"
          sideOffset={4}
          popupClassName="min-w-[140px]"
        >
          {isBuiltIn
            ? (
                <DropdownMenuItem
                  className="system-sm-semibold text-text-secondary"
                  onClick={handleView}
                >
                  View
                </DropdownMenuItem>
              )
            : (
                <DropdownMenuItem
                  className="system-sm-semibold text-text-secondary"
                  onClick={onEdit}
                >
                  Edit
                </DropdownMenuItem>
              )}
          <DropdownMenuItem
            className="system-sm-semibold text-text-secondary"
            onClick={handleCopyRules}
          >
            Copy
          </DropdownMenuItem>
          {!isBuiltIn && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                className="system-sm-semibold"
                onClick={openDeleteConfirm}
              >
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={showDeleteConfirm} onOpenChange={open => !open && setShowDeleteConfirm(false)}>
        <AlertDialogContent backdropProps={{ forceRender: true }}>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {`Delete "${rule.name}"?`}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              This access rule will be permanently deleted and removed from the resource authorization list.
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>Cancel</AlertDialogCancelButton>
            <AlertDialogConfirmButton
              disabled={isDeletingAccessRule}
              onClick={handleDelete}
            >
              Delete
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default AccessRuleRowMenu
