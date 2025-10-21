'use client'
import { useTranslation } from 'react-i18next'
import { Fragment, useMemo } from 'react'
import { useContext } from 'use-context-selector'
import { Menu, MenuButton, MenuItem, MenuItems, Transition } from '@headlessui/react'
import { CheckIcon, ChevronDownIcon } from '@heroicons/react/24/outline'
import { useProviderContext } from '@/context/provider-context'
import cn from '@/utils/classnames'
import type { Member } from '@/models/common'
import { deleteMemberOrCancelInvitation, updateMemberRole } from '@/service/common'
import { ToastContext } from '@/app/components/base/toast'

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
        'admin', 'editor', 'normal',
        ...(datasetOperatorEnabled ? ['dataset_operator'] : []),
      ]
    }
    if (operatorRole === 'admin') {
      return [
        'editor', 'normal',
        ...(datasetOperatorEnabled ? ['dataset_operator'] : []),
      ]
    }
    return []
  }, [operatorRole, datasetOperatorEnabled])
  const { notify } = useContext(ToastContext)
  const toHump = (name: string) => name.replace(/_(\w)/g, (all, letter) => letter.toUpperCase())
  const handleDeleteMemberOrCancelInvitation = async () => {
    try {
      await deleteMemberOrCancelInvitation({ url: `/workspaces/current/members/${member.id}` })
      onOperate()
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
    }
    catch {

    }
  }
  const handleUpdateMemberRole = async (role: string) => {
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
    <Menu as="div" className="relative h-full w-full">
      {
        ({ open }) => (
          <>
            <MenuButton className={cn('system-sm-regular group flex h-full w-full cursor-pointer items-center justify-between px-3 text-text-secondary hover:bg-state-base-hover', open && 'bg-state-base-hover')}>
              {RoleMap[member.role] || RoleMap.normal}
              <ChevronDownIcon className={cn('h-4 w-4 group-hover:block', open ? 'block' : 'hidden')} />
            </MenuButton>
            <Transition
              as={Fragment}
              enter="transition ease-out duration-100"
              enterFrom="transform opacity-0 scale-95"
              enterTo="transform opacity-100 scale-100"
              leave="transition ease-in duration-75"
              leaveFrom="transform opacity-100 scale-100"
              leaveTo="transform opacity-0 scale-95"
            >
              <MenuItems
                className={cn('absolute right-0 top-[52px] z-10 origin-top-right rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-sm')}
              >
                <div className="p-1">
                  {
                    roleList.map(role => (
                      <MenuItem key={role}>
                        <div className='flex cursor-pointer rounded-lg px-3 py-2 hover:bg-state-base-hover' onClick={() => handleUpdateMemberRole(role)}>
                          {
                            role === member.role
                              ? <CheckIcon className='mr-1 mt-[2px] h-4 w-4 text-text-accent' />
                              : <div className='mr-1 mt-[2px] h-4 w-4 text-text-accent' />
                          }
                          <div>
                            <div className='system-sm-semibold whitespace-nowrap text-text-secondary'>{t(`common.members.${toHump(role)}`)}</div>
                            <div className='system-xs-regular whitespace-nowrap text-text-tertiary'>{t(`common.members.${toHump(role)}Tip`)}</div>
                          </div>
                        </div>
                      </MenuItem>
                    ))
                  }
                </div>
                <MenuItem>
                  <div className='border-t border-divider-subtle p-1'>
                    <div className='flex cursor-pointer rounded-lg px-3 py-2 hover:bg-state-base-hover' onClick={handleDeleteMemberOrCancelInvitation}>
                      <div className='mr-1 mt-[2px] h-4 w-4 text-text-accent' />
                      <div>
                        <div className='system-sm-semibold whitespace-nowrap text-text-secondary'>{t('common.members.removeFromTeam')}</div>
                        <div className='system-xs-regular whitespace-nowrap text-text-tertiary'>{t('common.members.removeFromTeamTip')}</div>
                      </div>
                    </div>
                  </div>
                </MenuItem>
              </MenuItems>
            </Transition>
          </>
        )
      }
    </Menu>
  )
}

export default Operation
