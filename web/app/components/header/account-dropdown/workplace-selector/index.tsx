import { Fragment } from 'react'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import { Menu, Transition } from '@headlessui/react'
import { RiArrowDownSLine } from '@remixicon/react'
import cn from '@/utils/classnames'
import { switchWorkspace } from '@/service/common'
import { useWorkspacesContext } from '@/context/workspace-context'
import { ToastContext } from '@/app/components/base/toast'

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
                flex items-center p-0.5 gap-1.5 w-full
                group hover:bg-state-base-hover cursor-pointer ${open && 'bg-state-base-hover'} rounded-[10px]
              `,
            )}>
              <div className='flex items-center justify-center w-7 h-7 bg-[#EFF4FF] rounded-lg text-xs font-medium text-primary-600'>{currentWorkspace?.name[0].toLocaleUpperCase()}</div>
              <div className='flex flex-row'>
                <div className={'truncate max-w-[80px] text-text-secondary system-sm-medium'}>{currentWorkspace?.name}</div>
                <RiArrowDownSLine className='w-4 h-4 text-text-secondary' />
              </div>
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
                    flex w-[280px] flex-col items-start absolute left-[-15px] mt-1 rounded-xl shadows-shadow-lg
                  `,
                )}
              >
                <div className="flex flex-col p-1 pb-2 items-start self-stretch w-full rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg ">
                  <div className='flex px-3 pt-1 pb-0.5 items-start self-stretch'>
                    <span className='flex-1 text-text-tertiary system-xs-medium-uppercase'>{t('common.userProfile.workspace')}</span>
                  </div>
                  {
                    workspaces.map(workspace => (
                      <div className='flex py-1 pl-3 pr-2 items-center gap-2 self-stretch hover:bg-state-base-hover rounded-lg' key={workspace.id} onClick={() => handleSwitchWorkspace(workspace.id)}>
                        <div className='flex items-center justify-center w-6 h-6 bg-[#EFF4FF] rounded-md text-xs font-medium text-primary-600'>{workspace.name[0].toLocaleUpperCase()}</div>
                        <div className='line-clamp-1 grow overflow-hidden text-text-secondary text-ellipsis system-md-regular cursor-pointer'>{workspace.name}</div>
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
