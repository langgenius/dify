'use client'
import type { Member } from '@/models/common'
import { CheckIcon, ChevronDownIcon } from '@heroicons/react/24/outline'
import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { ToastContext } from '@/app/components/base/toast'
import { useProviderContext } from '@/context/provider-context'
import { deleteMemberOrCancelInvitation, updateMemberRole } from '@/service/common'
import { cn } from '@/utils/classnames'

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

const Operation = ({
  member,
  operatorRole,
  onOperate,
}: IOperationProps) => {
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
  const { notify } = useContext(ToastContext)
  const handleDeleteMemberOrCancelInvitation = async () => {
    setOpen(false)
    try {
      await deleteMemberOrCancelInvitation({ url: `/workspaces/current/members/${member.id}` })
      onOperate()
      notify({ type: 'success', message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }) })
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
      notify({ type: 'success', message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }) })
    }
    catch {

    }
  }

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      offset={{ mainAxis: 4 }}
    >
      <PortalToFollowElemTrigger asChild onClick={() => setOpen(prev => !prev)}>
        <div className={cn('system-sm-regular group flex h-full w-full cursor-pointer items-center justify-between px-3 text-text-secondary hover:bg-state-base-hover', open && 'bg-state-base-hover')}>
          {RoleMap[member.role] || RoleMap.normal}
          <ChevronDownIcon className={cn('h-4 w-4 shrink-0 group-hover:block', open ? 'block' : 'hidden')} />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[999]">
        <div className={cn('inline-flex flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-sm')}>
          <div className="p-1">
            {
              roleList.map(role => (
                <div key={role} className="flex cursor-pointer rounded-lg px-3 py-2 hover:bg-state-base-hover" onClick={() => handleUpdateMemberRole(role)}>
                  {
                    role === member.role
                      ? <CheckIcon className="mr-1 mt-[2px] h-4 w-4 text-text-accent" />
                      : <div className="mr-1 mt-[2px] h-4 w-4 text-text-accent" />
                  }
                  <div>
                    <div className="system-sm-semibold whitespace-nowrap text-text-secondary">{t(roleI18nKeyMap[role].label, { ns: 'common' })}</div>
                    <div className="system-xs-regular whitespace-nowrap text-text-tertiary">{t(roleI18nKeyMap[role].tip, { ns: 'common' })}</div>
                  </div>
                </div>
              ))
            }
          </div>
          <div className="border-t border-divider-subtle p-1">
            <div className="flex cursor-pointer rounded-lg px-3 py-2 hover:bg-state-base-hover" onClick={handleDeleteMemberOrCancelInvitation}>
              <div className="mr-1 mt-[2px] h-4 w-4 text-text-accent" />
              <div>
                <div className="system-sm-semibold whitespace-nowrap text-text-secondary">{t('members.removeFromTeam', { ns: 'common' })}</div>
                <div className="system-xs-regular whitespace-nowrap text-text-tertiary">{t('members.removeFromTeamTip', { ns: 'common' })}</div>
              </div>
            </div>
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(Operation)
