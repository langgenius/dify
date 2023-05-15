import { Fragment } from 'react'
import { switchWorkspace } from '@/service/common'
import { Menu, Transition } from '@headlessui/react'
import { ChevronRightIcon, CheckIcon } from '@heroicons/react/24/outline'
import cn from 'classnames'
import s from './index.module.css'
import { useContext } from 'use-context-selector'
import { ToastContext } from '@/app/components/base/toast'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'next/navigation'
import { useWorkspacesContext } from '@/context/workspace-context'

const itemClassName = `
  flex items-center px-3 py-2 h-10 cursor-pointer
`
const itemIconClassName = `
  shrink-0 mr-2 w-6 h-6 bg-[#EFF4FF] rounded-md
`
const itemNameClassName = `
  grow mr-2 text-sm text-gray-700 text-left
`
const itemCheckClassName = `
  shrink-0 w-4 h-4 text-primary-600
`

const WorkplaceSelector = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const { notify } = useContext(ToastContext)
  const { workspaces } = useWorkspacesContext()
  const currentWrokspace = workspaces.filter(item => item.current)?.[0]

  const handleSwitchWorkspace = async (tenant_id: string) => {
    try {
      await switchWorkspace({ url: `/workspaces/switch`, body: { tenant_id } })
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      router.replace('/apps')
    } catch (e) {
      notify({ type: 'error', message: t('common.provider.saveFailed') })
    } finally {
    }
  }

  return (
    <Menu as="div" className="relative w-full h-full">
      {
        ({ open }) => (
          <>
            <Menu.Button className={cn(
              `
                ${itemClassName} w-full
                group hover:bg-gray-50 cursor-pointer ${open && 'bg-gray-50'}
              `
            )}>
              <div className={itemIconClassName} />
              <div className={`${itemNameClassName} truncate`}>{currentWrokspace?.name}</div>
              <ChevronRightIcon className='shrink-0 w-[14px] h-[14px]' />
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
                    absolute top-[1px] min-w-[200px] z-10 bg-white border-[0.5px] border-gray-200
                    divide-y divide-gray-100 origin-top-right rounded-xl
                  `,
                  s.popup
                )}
              >
                <div className="px-1 py-1">
                  {
                    workspaces.map(workspace => (
                      <div className={itemClassName} key={workspace.id} onClick={() => handleSwitchWorkspace(workspace.id)}>
                        <div className={itemIconClassName} />
                        <div className={itemNameClassName}>{workspace.name}</div>
                        {workspace.current && <CheckIcon className={itemCheckClassName} />}
                      </div>
                    ))
                  }
                </div>
              </Menu.Items>
            </Transition>
          </>
        )
      }
    </Menu>
  )
}

export default WorkplaceSelector