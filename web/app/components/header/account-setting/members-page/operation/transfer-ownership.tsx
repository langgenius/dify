'use client'
import { Menu, MenuButton, MenuItem, MenuItems, Transition } from '@headlessui/react'
import {
  RiArrowDownSLine,
} from '@remixicon/react'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { useAppContext } from '@/context/app-context'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useWorkspacePermissions } from '@/service/use-workspace'
import { cn } from '@/utils/classnames'

type Props = {
  onOperate: () => void
}

const TransferOwnership = ({ onOperate }: Props) => {
  const { t } = useTranslation()
  const { currentWorkspace } = useAppContext()
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  const { data: workspacePermissions, isFetching: isFetchingWorkspacePermissions } = useWorkspacePermissions(currentWorkspace!.id, systemFeatures.branding.enabled)
  if (systemFeatures.branding.enabled) {
    if (isFetchingWorkspacePermissions) {
      return <Loading />
    }
    if (!workspacePermissions || workspacePermissions.allow_owner_transfer !== true) {
      return <span className="system-sm-regular px-3 text-text-secondary">{t('members.owner', { ns: 'common' })}</span>
    }
  }

  return (
    <Menu as="div" className="relative h-full w-full">
      {
        ({ open }) => (
          <>
            <MenuButton className={cn('system-sm-regular group flex h-full w-full cursor-pointer items-center justify-between px-3 text-text-secondary hover:bg-state-base-hover', open && 'bg-state-base-hover')}>
              {t('members.owner', { ns: 'common' })}
              <RiArrowDownSLine className={cn('h-4 w-4 group-hover:block', open ? 'block' : 'hidden')} />
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
                  <MenuItem>
                    <div className="flex cursor-pointer rounded-lg px-3 py-2 hover:bg-state-base-hover" onClick={onOperate}>
                      <div className="system-md-regular whitespace-nowrap text-text-secondary">{t('members.transferOwnership', { ns: 'common' })}</div>
                    </div>
                  </MenuItem>
                </div>
              </MenuItems>
            </Transition>
          </>
        )
      }
    </Menu>
  )
}

export default TransferOwnership
