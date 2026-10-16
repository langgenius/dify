'use client'

import type { Role } from '@/models/access-control'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'

type CopyMembersConfirmDialogProps = {
  role: Role
  isCopyingRole: boolean
  onOpenChange: (open: boolean) => void
  onDuplicate: (copyMember: boolean) => void
}

export function CopyMembersConfirmDialog({
  role,
  isCopyingRole,
  onOpenChange,
  onDuplicate,
}: CopyMembersConfirmDialogProps) {
  const { t } = useTranslation(['common', 'permission'])
  const { data: membersOfRole, isPending: isLoadingMembersOfRole } = useQuery(
    consoleQuery.workspaces.current.rbac.roles.byRoleId.members.get.queryOptions({
      input: { params: { role_id: role.id }, query: { page: 1, limit: 9999 } },
    }),
  )
  const memberCount = membersOfRole?.pagination?.total_count ?? 0
  const isLoadingMemberCount = isLoadingMembersOfRole && !membersOfRole
  const isActionDisabled = isCopyingRole || isLoadingMemberCount

  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent backdropProps={{ forceRender: true }}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(($) => $['role.copyMembersTitle'], { ns: 'permission' })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isLoadingMemberCount
              ? t(($) => $['role.copyMembersLoading'], { ns: 'permission' })
              : t(($) => $['role.copyMembersDescription'], {
                  ns: 'permission',
                  name: role.name,
                  count: memberCount,
                })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            variant="secondary"
            disabled={isActionDisabled}
            onClick={() => onDuplicate(false)}
          >
            {t(($) => $['operation.skip'], { ns: 'common' })}
          </Button>
          <Button
            variant="primary"
            disabled={isLoadingMemberCount}
            loading={isCopyingRole}
            onClick={() => onDuplicate(true)}
          >
            {t(($) => $['operation.copy'], { ns: 'common' })}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
