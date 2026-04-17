'use client'
import type { Member } from '@/models/common'
import { cn } from '@langgenius/dify-ui/cn'
import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/app/components/base/ui/dropdown-menu'
import { toast } from '@/app/components/base/ui/toast'
import { useProviderContext } from '@/context/provider-context'
import { deleteMemberOrCancelInvitation, updateMemberRole } from '@/service/common'

type IOperationProps = {
  member: Member
  operatorRole: string
  onOperate: () => void
}
const roleI18nKeyMap = {
  admin: { label: 'members.admin', tip: 'members.adminTip' },
  editor: { label: 'members.editor', tip: 'members.editorTip' },
  normal: { label: 'members.normal', tip: 'members.normalTip' },
  dataset_operator: { label: 'members.datasetOperator', tip: 'members.datasetOperatorTip' },
} as const
type OperationRoleKey = keyof typeof roleI18nKeyMap
const Operation = ({ member, operatorRole, onOperate }: IOperationProps) => {
  const [open, setOpen] = useState(false)
  const { t } = useTranslation()
  const { datasetOperatorEnabled } = useProviderContext()
  const RoleMap = {
    owner: t('members.owner', { ns: 'common' }),
    admin: t('members.admin', { ns: 'common' }),
    editor: t('members.editor', { ns: 'common' }),
    normal: t('members.normal', { ns: 'common' }),
    dataset_operator: t('members.datasetOperator', { ns: 'common' }),
  }
  const roleList = useMemo((): OperationRoleKey[] => {
    if (operatorRole === 'owner') {
      return [
        'admin',
        'editor',
        'normal',
        ...(datasetOperatorEnabled ? ['dataset_operator'] as const : []),
      ]
    }
    if (operatorRole === 'admin') {
      return [
        'editor',
        'normal',
        ...(datasetOperatorEnabled ? ['dataset_operator'] as const : []),
      ]
    }
    return []
  }, [operatorRole, datasetOperatorEnabled])
  const handleDeleteMemberOrCancelInvitation = async () => {
    setOpen(false)
    try {
      await deleteMemberOrCancelInvitation({ url: `/workspaces/current/members/${member.id}` })
      onOperate()
      toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
    }
    catch {
    }
  }
  const handleUpdateMemberRole = async (role: string) => {
    setOpen(false)
    try {
      await updateMemberRole({
        url: `/workspaces/current/members/${member.id}/update-role`,
        body: { role },
      })
      onOperate()
      toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
    }
    catch {
    }
  }
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={<div className={cn('group flex h-full w-full cursor-pointer items-center justify-between px-3 system-sm-regular text-text-secondary hover:bg-state-base-hover', open && 'bg-state-base-hover')} />}
      >
        {RoleMap[member.role] || RoleMap.normal}
        <span aria-hidden className={cn('i-ri-arrow-down-s-line h-4 w-4 shrink-0 group-hover:block', open ? 'block' : 'hidden')} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement="bottom-end"
        sideOffset={4}
        popupClassName="inline-flex flex-col rounded-xl p-0"
      >
        <div className="p-1">
          {roleList.map(role => (
            <DropdownMenuItem
              key={role}
              className="h-auto items-start gap-2 rounded-lg px-3 py-2"
              onClick={() => handleUpdateMemberRole(role)}
            >
              {role === member.role
                ? <span aria-hidden className="mt-[2px] i-ri-check-line h-4 w-4 shrink-0 text-text-accent" />
                : <span aria-hidden className="mt-[2px] h-4 w-4 shrink-0" />}
              <div>
                <div className="system-sm-semibold whitespace-nowrap text-text-secondary">{t(roleI18nKeyMap[role].label, { ns: 'common' })}</div>
                <div className="system-xs-regular whitespace-nowrap text-text-tertiary">{t(roleI18nKeyMap[role].tip, { ns: 'common' })}</div>
              </div>
            </DropdownMenuItem>
          ))}
        </div>
        <DropdownMenuSeparator className="my-0" />
        <div className="p-1">
          <DropdownMenuItem
            className="h-auto items-start gap-2 rounded-lg px-3 py-2"
            onClick={handleDeleteMemberOrCancelInvitation}
          >
            <span aria-hidden className="mt-[2px] h-4 w-4 shrink-0" />
            <div>
              <div className="system-sm-semibold whitespace-nowrap text-text-secondary">{t('members.removeFromTeam', { ns: 'common' })}</div>
              <div className="system-xs-regular whitespace-nowrap text-text-tertiary">{t('members.removeFromTeamTip', { ns: 'common' })}</div>
            </div>
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
export default memo(Operation)
