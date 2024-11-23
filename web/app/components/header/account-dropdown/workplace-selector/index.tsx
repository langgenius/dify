import { Fragment } from 'react'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import { Menu, Transition } from '@headlessui/react'
import s from './index.module.css'
import cn from '@/utils/classnames'
import { switchWorkspace } from '@/service/common'
import { useWorkspacesContext } from '@/context/workspace-context'
import { ChevronRight } from '@/app/components/base/icons/src/vender/line/arrows'
import { Check } from '@/app/components/base/icons/src/vender/line/general'
import { ToastContext } from '@/app/components/base/toast'

const itemClassName = `
  flex items-center px-3 py-2 h-10 cursor-pointer
`
const itemIconClassName = `
  shrink-0 mr-2 flex items-center justify-center w-6 h-6 bg-[#EFF4FF] rounded-md text-xs font-medium text-primary-600
`
const itemNameClassName = `
  grow mr-2 text-sm text-gray-700 text-left
`
const itemCheckClassName = `
  shrink-0 w-4 h-4 text-primary-600
`

const WorkplaceSelector = () => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const { workspaces } = useWorkspacesContext()
  const currentWorkspace = workspaces.find(v => v.current)

  const handleSwitchWorkspace = async (tenant_id: string) => {
    try {
      if (currentWorkspace?.id === tenant_id)
        return
      await switchWorkspace({ url: '/workspaces/switch', body: { tenant_id } })
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      location.assign(`${location.origin}`)
    }
    catch (e) {
      notify({ type: 'error', message: t('common.provider.saveFailed') })
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
                group hover:bg-gray-50 cursor-pointer ${open && 'bg-gray-50'} rounded-lg
              `,
            )}>
              <div className={itemIconClassName}>{currentWorkspace?.name[0].toLocaleUpperCase()}</div>
              <div className={`${itemNameClassName} truncate`}>{currentWorkspace?.name}</div>
              <ChevronRight className='shrink-0 w-[14px] h-[14px] text-gray-500' />
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
                    absolute top-[1px] min-w-[200px] max-h-[70vh] overflow-y-scroll z-10 bg-white border-[0.5px] border-gray-200
                    divide-y divide-gray-100 origin-top-right rounded-xl
                  `,
                  s.popup,
                )}
              >
                <div className="px-1 py-1">
                  {
                    workspaces.map(workspace => (
                      <div className={itemClassName} key={workspace.id} onClick={() => handleSwitchWorkspace(workspace.id)}>
                        <div className={itemIconClassName}>{workspace.name[0].toLocaleUpperCase()}</div>
                        <div className={itemNameClassName}>{workspace.name}</div>
                        {workspace.current && <Check className={itemCheckClassName} />}
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
