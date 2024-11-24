'use client'
import { useTranslation } from 'react-i18next'
import { Fragment, useMemo } from 'react'
import { useContext } from 'use-context-selector'
import { Menu, Transition } from '@headlessui/react'
import { CheckIcon, ChevronDownIcon } from '@heroicons/react/24/outline'
import s from './index.module.css'
import { useProviderContext } from '@/context/provider-context'
import cn from '@/utils/classnames'
import type { Member } from '@/models/common'
import { deleteMemberOrCancelInvitation, updateMemberRole } from '@/service/common'
import { ToastContext } from '@/app/components/base/toast'

const itemClassName = `
  flex px-3 py-2 cursor-pointer hover:bg-gray-50 rounded-lg
`
const itemIconClassName = `
  w-4 h-4 mt-[2px] mr-1 text-primary-600
`
const itemTitleClassName = `
  leading-[20px] text-sm text-gray-700 whitespace-nowrap
`
const itemDescClassName = `
  leading-[18px] text-xs text-gray-500 whitespace-nowrap
`

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
        ...['admin', 'editor', 'normal'],
        ...(datasetOperatorEnabled ? ['dataset_operator'] : []),
      ]
    }
    if (operatorRole === 'admin') {
      return [
        ...['editor', 'normal'],
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
    catch (e) {

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
    catch (e) {

    }
  }

  return (
    <Menu as="div" className="relative w-full h-full">
      {
        ({ open }) => (
          <>
            <Menu.Button className={cn(
              `
                  group flex items-center justify-between w-full h-full
                  hover:bg-gray-100 cursor-pointer ${open && 'bg-gray-100'}
                  text-[13px] text-gray-700 px-3
                `,
            )}>
              {RoleMap[member.role] || RoleMap.normal}
              <ChevronDownIcon className={`w-4 h-4 group-hover:block ${open ? 'block' : 'hidden'}`} />
            </Menu.Button>
            <Transition
              as={Fragment}
              enter="transition ease-out duration-100"
              enterFrom="transform opacity-0 scale-95"
              enterTo="transform opacity-100 scale-100"
              leave="transition ease-in duration-75"
              leaveFrom="transform opacity-100 scale-100"
              leaveTo="transform opacity-0 scale-95"
            >
              <Menu.Items
                className={cn(
                  `
                      absolute right-0 top-[52px] z-10 bg-white border-[0.5px] border-gray-200
                      divide-y divide-gray-100 origin-top-right rounded-lg
                    `,
                  s.popup,
                )}
              >
                <div className="px-1 py-1">
                  {
                    roleList.map(role => (
                      <Menu.Item key={role}>
                        <div className={itemClassName} onClick={() => handleUpdateMemberRole(role)}>
                          {
                            role === member.role
                              ? <CheckIcon className={itemIconClassName} />
                              : <div className={itemIconClassName} />
                          }
                          <div>
                            <div className={itemTitleClassName}>{t(`common.members.${toHump(role)}`)}</div>
                            <div className={itemDescClassName}>{t(`common.members.${toHump(role)}Tip`)}</div>
                          </div>
                        </div>
                      </Menu.Item>
                    ))
                  }
                </div>
                <Menu.Item>
                  <div className='px-1 py-1'>
                    <div className={itemClassName} onClick={handleDeleteMemberOrCancelInvitation}>
                      <div className={itemIconClassName} />
                      <div>
                        <div className={itemTitleClassName}>{t('common.members.removeFromTeam')}</div>
                        <div className={itemDescClassName}>{t('common.members.removeFromTeamTip')}</div>
                      </div>
                    </div>
                  </div>
                </Menu.Item>
              </Menu.Items>
            </Transition>
          </>
        )
      }
    </Menu>
  )
}

export default Operation
