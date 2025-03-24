import { Fragment } from 'react'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import { Menu, MenuButton, MenuItems, Transition } from '@headlessui/react'
import { RiArrowDownSLine } from '@remixicon/react'
import cn from '@/utils/classnames'
import { switchWorkspace } from '@/service/common'
import { useWorkspacesContext } from '@/context/workspace-context'
import { ToastContext } from '@/app/components/base/toast'
import PlanBadge from '../../plan-badge'
import type { Plan } from '@/app/components/billing/type'

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
    <Menu as="div" className="relative h-full w-full">
      {
        ({ open }) => (
          <>
            <MenuButton className={cn(
              `
                group flex w-full cursor-pointer items-center
                gap-1.5 p-0.5 hover:bg-state-base-hover ${open && 'bg-state-base-hover'} rounded-[10px]
              `,
            )}>
              <div className='flex h-7 w-7 items-center justify-center rounded-lg bg-[#EFF4FF] text-xs font-medium text-primary-600'>{currentWorkspace?.name[0].toLocaleUpperCase()}</div>
              <div className='flex flex-row'>
                <div className={'system-sm-medium max-w-[80px] truncate text-text-secondary'}>{currentWorkspace?.name}</div>
                <RiArrowDownSLine className='h-4 w-4 text-text-secondary' />
              </div>
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
                className={cn(
                  `
                    shadows-shadow-lg absolute left-[-15px] mt-1 flex w-[280px] flex-col items-start rounded-xl
                  `,
                )}
              >
                <div className="flex w-full flex-col items-start self-stretch rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 pb-2 shadow-lg ">
                  <div className='flex items-start self-stretch px-3 pb-0.5 pt-1'>
                    <span className='system-xs-medium-uppercase flex-1 text-text-tertiary'>{t('common.userProfile.workspace')}</span>
                  </div>
                  {
                    workspaces.map(workspace => (
                      <div className='flex items-center gap-2 self-stretch rounded-lg py-1 pl-3 pr-2 hover:bg-state-base-hover' key={workspace.id} onClick={() => handleSwitchWorkspace(workspace.id)}>
                        <div className='flex h-6 w-6 items-center justify-center rounded-md bg-[#EFF4FF] text-xs font-medium text-primary-600'>{workspace.name[0].toLocaleUpperCase()}</div>
                        <div className='system-md-regular line-clamp-1 grow cursor-pointer overflow-hidden text-ellipsis text-text-secondary'>{workspace.name}</div>
                        <PlanBadge plan={workspace.plan as Plan} />
                      </div>
                    ))
                  }
                </div>
              </MenuItems>
            </Transition>
          </>
        )
      }
    </Menu>
  )
}

export default WorkplaceSelector
