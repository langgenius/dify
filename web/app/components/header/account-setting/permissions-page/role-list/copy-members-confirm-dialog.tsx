'use client'

import type { Role } from '@/models/access-control'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from '#i18n'
import { useGetMembersOfRole } from '@/service/access-control/use-workspace-roles'

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
  const { t } = useTranslation()
  const { data: membersOfRole, isPending: isLoadingMembersOfRole } = useGetMembersOfRole({
    roleId: role.id,
    page: 1,
    limit: 9999,
  })
  const memberCount = membersOfRole?.pagination.total_count ?? 0
  const isLoadingMemberCount = isLoadingMembersOfRole && !membersOfRole
  const isActionDisabled = isCopyingRole || isLoadingMemberCount

  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent
        backdropProps={{
          forceRender: true,
          onClick: () => onOpenChange(false),
        }}
      >
        <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
          <AlertDialogTitle className="w-full title-2xl-semi-bold text-text-primary">
            {t('role.copyMembersTitle', { ns: 'permission' })}
          </AlertDialogTitle>
          <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-secondary">
            {
              isLoadingMemberCount
                ? t('role.copyMembersLoading', { ns: 'permission' })
                : t('role.copyMembersDescription', {
                    ns: 'permission',
                    name: role.name,
                    count: memberCount,
                  })
            }
          </AlertDialogDescription>
        </div>
        <AlertDialogActions>
          <Button
            variant="secondary"
            disabled={isActionDisabled}
            onClick={() => onDuplicate(false)}
          >
            {t('operation.skip', { ns: 'common' })}
          </Button>
          <Button
            variant="primary"
            disabled={isActionDisabled}
            loading={isCopyingRole}
            onClick={() => onDuplicate(true)}
          >
            {t('operation.copy', { ns: 'common' })}
          </Button>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}
