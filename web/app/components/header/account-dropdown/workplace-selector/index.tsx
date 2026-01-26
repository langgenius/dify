import type { Plan } from '@/app/components/billing/type'
import { Menu, MenuButton, MenuItems, Transition } from '@headlessui/react'
import { RiArrowDownSLine } from '@remixicon/react'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { ToastContext } from '@/app/components/base/toast'
import PlanBadge from '@/app/components/header/plan-badge'
import { useWorkspacesContext } from '@/context/workspace-context'
import { switchWorkspace } from '@/service/common'
import { cn } from '@/utils/classnames'
import { basePath } from '@/utils/var'

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
      notify({ type: 'success', message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }) })
      location.assign(`${location.origin}${basePath}`)
    }
    catch {
      notify({ type: 'error', message: t('provider.saveFailed', { ns: 'common' }) })
    }
  }

  return (
    <Menu as="div" className="min-w-0">
      {
        ({ open }) => (
          <>
            <MenuButton className={cn(
              `
                group flex w-full cursor-pointer items-center
                p-0.5 hover:bg-state-base-hover ${open && 'bg-state-base-hover'} rounded-[10px]
              `,
            )}
            >
              <div className="mr-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-components-icon-bg-blue-solid text-[13px] max-[800px]:mr-0">
                <span className="h-6 bg-gradient-to-r from-components-avatar-shape-fill-stop-0 to-components-avatar-shape-fill-stop-100 bg-clip-text align-middle font-semibold uppercase leading-6 text-shadow-shadow-1 opacity-90">{currentWorkspace?.name[0]?.toLocaleUpperCase()}</span>
              </div>
              <div className="flex min-w-0 items-center">
                <div className="system-sm-medium min-w-0  max-w-[149px] truncate text-text-secondary max-[800px]:hidden">{currentWorkspace?.name}</div>
                <RiArrowDownSLine className="h-4 w-4 shrink-0 text-text-secondary" />
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
                anchor="bottom start"
                className={cn(
                  `
                    shadows-shadow-lg absolute left-[-15px] z-[1000] mt-1 flex max-h-[400px] w-[280px] flex-col items-start overflow-y-auto
                    rounded-xl bg-components-panel-bg-blur backdrop-blur-[5px]
                  `,
                )}
              >
                <div className="flex w-full flex-col items-start self-stretch rounded-xl border-[0.5px] border-components-panel-border p-1 pb-2 shadow-lg ">
                  <div className="flex items-start self-stretch px-3 pb-0.5 pt-1">
                    <span className="system-xs-medium-uppercase flex-1 text-text-tertiary">{t('userProfile.workspace', { ns: 'common' })}</span>
                  </div>
                  {
                    workspaces.map(workspace => (
                      <div className="flex items-center gap-2 self-stretch rounded-lg py-1 pl-3 pr-2 hover:bg-state-base-hover" key={workspace.id} onClick={() => handleSwitchWorkspace(workspace.id)}>
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-components-icon-bg-blue-solid text-[13px]">
                          <span className="h-6 bg-gradient-to-r from-components-avatar-shape-fill-stop-0 to-components-avatar-shape-fill-stop-100 bg-clip-text align-middle font-semibold uppercase leading-6 text-shadow-shadow-1 opacity-90">{workspace?.name[0]?.toLocaleUpperCase()}</span>
                        </div>
                        <div className="system-md-regular line-clamp-1 grow cursor-pointer overflow-hidden text-ellipsis text-text-secondary">{workspace.name}</div>
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
