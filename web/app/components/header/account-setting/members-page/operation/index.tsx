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

const Operation = ({
  member,
  operatorRole,
  onOperate,
}: IOperationProps) => {
  const [open, setOpen] = useState(false)
  const { t } = useTranslation()
  const { datasetOperatorEnabled } = useProviderContext()
  const RoleMap = {
    owner: t('common.members.owner'),
    admin: t('common.members.admin'),
    editor: t('common.members.editor'),
    normal: t('common.members.normal'),
    dataset_operator: t('common.members.datasetOperator'),
  }
  const roleList = useMemo(() => {
    if (operatorRole === 'owner') {
      return [
        'admin',
        'editor',
        'normal',
        ...(datasetOperatorEnabled ? ['dataset_operator'] : []),
      ]
    }
    if (operatorRole === 'admin') {
      return [
        'editor',
        'normal',
        ...(datasetOperatorEnabled ? ['dataset_operator'] : []),
      ]
    }
    return []
  }, [operatorRole, datasetOperatorEnabled])
  const { notify } = useContext(ToastContext)
  const toHump = (name: string) => name.replace(/_(\w)/g, (all, letter) => letter.toUpperCase())
  const handleDeleteMemberOrCancelInvitation = async () => {
    setOpen(false)
    try {
      await deleteMemberOrCancelInvitation({ url: `/workspaces/current/members/${member.id}` })
      onOperate()
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
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
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
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
                    <div className="system-sm-semibold whitespace-nowrap text-text-secondary">{t(`common.members.${toHump(role)}` as any)}</div>
                    <div className="system-xs-regular whitespace-nowrap text-text-tertiary">{t(`common.members.${toHump(role)}Tip` as any)}</div>
                  </div>
                </div>
              ))
            }
          </div>
          <div className="border-t border-divider-subtle p-1">
            <div className="flex cursor-pointer rounded-lg px-3 py-2 hover:bg-state-base-hover" onClick={handleDeleteMemberOrCancelInvitation}>
              <div className="mr-1 mt-[2px] h-4 w-4 text-text-accent" />
              <div>
                <div className="system-sm-semibold whitespace-nowrap text-text-secondary">{t('common.members.removeFromTeam')}</div>
                <div className="system-xs-regular whitespace-nowrap text-text-tertiary">{t('common.members.removeFromTeamTip')}</div>
              </div>
            </div>
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(Operation)
