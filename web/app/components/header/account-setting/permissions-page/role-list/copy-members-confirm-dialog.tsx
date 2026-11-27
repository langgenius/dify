'use client'

import type { Role } from '@/models/access-control'
import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import {
  AlertDialog,
  AlertDialogConfirmButton,
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
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'

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
  const membersOfRoleQuery = useQuery(
    consoleQuery.workspaces.current.rbac.roles.byRoleId.members.get.queryOptions({
      input: { params: { role_id: role.id }, query: { page: 1, limit: 9999 } },
    }),
  )
  const { data: membersOfRole, isPending: isLoadingMembersOfRole } = membersOfRoleQuery
  const memberCountLoad = useOwnedQueryError(membersOfRoleQuery)
  const memberCountErrorMessage = useRequestErrorMessage(
    memberCountLoad?.error,
    t(($) => $['api.actionFailed'], { ns: 'common' }),
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
          {memberCountLoad ? (
            <Alert type="error">
              <AlertTitle>{memberCountErrorMessage}</AlertTitle>
              <AlertActions>
                <Button
                  size="small"
                  loading={memberCountLoad.retrying}
                  onClick={memberCountLoad.retry}
                >
                  {t(($) => $['operation.retry'], { ns: 'common' })}
                </Button>
              </AlertActions>
            </Alert>
          ) : (
            <AlertDialogDescription>
              {isLoadingMemberCount
                ? t(($) => $['role.copyMembersLoading'], { ns: 'permission' })
                : t(($) => $['role.copyMembersDescription'], {
                    ns: 'permission',
                    name: role.name,
                    count: memberCount,
                  })}
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogConfirmButton
            variant="secondary"
            tone="default"
            disabled={isActionDisabled}
            onClick={() => onDuplicate(false)}
          >
            {t(($) => $['operation.skip'], { ns: 'common' })}
          </AlertDialogConfirmButton>
          <AlertDialogConfirmButton
            tone="default"
            disabled={isLoadingMemberCount}
            loading={isCopyingRole}
            onClick={() => onDuplicate(true)}
          >
            {t(($) => $['operation.copy'], { ns: 'common' })}
          </AlertDialogConfirmButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
