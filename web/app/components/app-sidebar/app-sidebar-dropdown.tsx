import type { AppInfoActions } from './app-info/use-app-info-actions'
import type { NavIcon } from './nav-link'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import {
  RiEqualizer2Line,
  RiMenuLine,
} from '@remixicon/react'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useAppContext } from '@/context/app-context'
import AppIcon from '../base/app-icon'
import Divider from '../base/divider'
import AppInfo from './app-info'
import { getAppModeLabel } from './app-info/app-mode-labels'
import NavLink from './nav-link'

type Props = {
  navigation: Array<{
    name: string
    href: string
    icon: NavIcon
    selectedIcon: NavIcon
  }>
  appInfoActions?: AppInfoActions
}

const AppSidebarDropdown = ({ navigation, appInfoActions }: Props) => {
  const { t } = useTranslation()
  const { isCurrentWorkspaceEditor } = useAppContext()
  const appDetail = useAppStore(state => state.appDetail)
  const [detailExpand, setDetailExpand] = useState(false)
  const [open, setOpen] = useState(false)

  if (!appDetail)
    return null

  return (
    <>
      <div className="fixed top-2 left-2 z-20">
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger
            aria-label={t('operation.more', { ns: 'common' })}
            className={cn(
              'flex cursor-pointer items-center rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-1 shadow-lg backdrop-blur-xs hover:bg-background-default-hover',
              open && 'bg-background-default-hover',
            )}
          >
            <AppIcon
              size="small"
              iconType={appDetail.icon_type}
              icon={appDetail.icon}
              background={appDetail.icon_background}
              imageUrl={appDetail.icon_url}
            />
            <RiMenuLine className="h-4 w-4 text-text-tertiary" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            placement="bottom-start"
            sideOffset={4}
            popupClassName="border-none bg-transparent p-0 shadow-none backdrop-blur-none"
          >
            <div className={cn('w-[305px] rounded-xl border-[0.5px] border-components-panel-border bg-background-default-subtle shadow-lg')}>
              <div className="p-2">
                <div
                  className={cn('flex flex-col gap-2 rounded-lg p-2 pb-2.5', isCurrentWorkspaceEditor && 'cursor-pointer hover:bg-state-base-hover')}
                  onClick={() => {
                    if (appInfoActions)
                      appInfoActions.setPanelOpen(true)
                    else
                      setDetailExpand(true)
                    setOpen(false)
                  }}
                >
                  <div className="flex items-center justify-between self-stretch">
                    <AppIcon
                      size="large"
                      iconType={appDetail.icon_type}
                      icon={appDetail.icon}
                      background={appDetail.icon_background}
                      imageUrl={appDetail.icon_url}
                    />
                    <div className="flex items-center justify-center rounded-md p-0.5">
                      <div className="flex h-5 w-5 items-center justify-center">
                        <RiEqualizer2Line className="h-4 w-4 text-text-tertiary" />
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-start gap-1">
                    <div className="flex w-full">
                      <div className="truncate system-md-semibold text-text-secondary">{appDetail.name}</div>
                    </div>
                    <div className="system-2xs-medium-uppercase text-text-tertiary">{getAppModeLabel(appDetail.mode, t)}</div>
                  </div>
                </div>
              </div>
              <div className="px-4">
                <Divider bgStyle="gradient" />
              </div>
              <nav className="space-y-0.5 px-3 pt-4 pb-6">
                {navigation.map((item, index) => {
                  return (
                    <NavLink key={index} mode="expand" iconMap={{ selected: item.selectedIcon, normal: item.icon }} name={item.name} href={item.href} />
                  )
                })}
              </nav>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {!appInfoActions && (
        <div className="z-20">
          <AppInfo expand onlyShowDetail openState={detailExpand} onDetailExpand={setDetailExpand} />
        </div>
      )}
    </>
  )
}

export default AppSidebarDropdown
