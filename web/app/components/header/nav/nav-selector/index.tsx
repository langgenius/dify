'use client'
import type { AppIconType, AppModeEnum } from '@/types/app'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
} from '@remixicon/react'
import { debounce } from 'es-toolkit/compat'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { AppTypeIcon } from '@/app/components/app/type-selector'
import AppIcon from '@/app/components/base/app-icon'
import { FileArrow01, FilePlus01, FilePlus02 } from '@/app/components/base/icons/src/vender/line/files'
import Loading from '@/app/components/base/loading'
import { useAppContext } from '@/context/app-context'
import { useRouter } from '@/next/navigation'

export type NavItem = {
  id: string
  name: string
  link: string
  icon_type: AppIconType | null
  icon: string
  icon_background: string | null
  icon_url: string | null
  mode?: AppModeEnum
}
export type INavSelectorProps = {
  navigationItems: NavItem[]
  curNav?: Omit<NavItem, 'link'>
  createText: string
  isApp?: boolean
  onCreate: (state: string) => void
  onLoadMore?: () => void
  isLoadingMore?: boolean
}

type AppCreateMenuProps = {
  createText: string
  startFromBlankText: string
  startFromTemplateText: string
  importDSLText: string
  onCreate: (state: string) => void
}

const AppCreateMenu = ({
  createText,
  startFromBlankText,
  startFromTemplateText,
  importDSLText,
  onCreate,
}: AppCreateMenuProps) => {
  const [open, setOpen] = useState(false)

  const handleCreate = (state: string) => {
    setOpen(false)
    onCreate(state)
  }

  return (
    <div className="relative h-full w-full" onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="w-full p-1 text-left"
        onClick={() => setOpen(value => !value)}
        onMouseEnter={() => setOpen(true)}
      >
        <div className={cn(
          'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-[6px] hover:bg-state-base-hover',
          open && 'bg-state-base-hover!',
        )}
        >
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-background-default">
            <RiAddLine className="h-4 w-4 text-text-primary" />
          </div>
          <div className="grow text-left text-[14px] font-normal text-text-secondary">{createText}</div>
          <RiArrowRightSLine className="h-3.5 w-3.5 shrink-0 text-text-primary" />
        </div>
      </button>
      {open && (
        <div
          className="absolute top-[3px] right-[-198px] z-10 min-w-[200px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg"
          onMouseEnter={() => setOpen(true)}
        >
          <div className="p-1">
            <button type="button" className={cn('flex w-full cursor-pointer items-center rounded-lg px-3 py-[6px] text-left font-normal text-text-secondary hover:bg-state-base-hover')} onClick={() => handleCreate('blank')}>
              <FilePlus01 className="mr-2 h-4 w-4 shrink-0 text-text-secondary" />
              {startFromBlankText}
            </button>
            <button type="button" className={cn('flex w-full cursor-pointer items-center rounded-lg px-3 py-[6px] text-left font-normal text-text-secondary hover:bg-state-base-hover')} onClick={() => handleCreate('template')}>
              <FilePlus02 className="mr-2 h-4 w-4 shrink-0 text-text-secondary" />
              {startFromTemplateText}
            </button>
          </div>
          <div className="border-t border-divider-regular p-1">
            <button type="button" className={cn('flex w-full cursor-pointer items-center rounded-lg px-3 py-[6px] text-left font-normal text-text-secondary hover:bg-state-base-hover')} onClick={() => handleCreate('dsl')}>
              <FileArrow01 className="mr-2 h-4 w-4 shrink-0 text-text-secondary" />
              {importDSLText}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const NavSelector = ({ curNav, navigationItems, createText, isApp, onCreate, onLoadMore, isLoadingMore }: INavSelectorProps) => {
  const { t } = useTranslation()
  const router = useRouter()
  const { isCurrentWorkspaceEditor } = useAppContext()
  const setAppDetail = useAppStore(state => state.setAppDetail)

  const handleScroll = useCallback(debounce((e) => {
    if (typeof onLoadMore === 'function') {
      const { clientHeight, scrollHeight, scrollTop } = e.target

      if (clientHeight + scrollTop > scrollHeight - 50)
        onLoadMore()
    }
  }, 50), [])

  return (
    <Menu as="div" className="relative">
      {({ open }) => (
        <>
          <MenuButton className={cn(
            'hover:hover:bg-components-main-nav-nav-button-bg-active-hover group inline-flex h-7 w-full items-center justify-center rounded-[10px] pr-2.5 pl-2 text-[14px] font-semibold text-components-main-nav-nav-button-text-active',
            open && 'bg-components-main-nav-nav-button-bg-active',
          )}
          >
            <div className="max-w-[157px] truncate" title={curNav?.name}>{curNav?.name}</div>
            <RiArrowDownSLine
              className={cn('ml-1 h-3 w-3 shrink-0 opacity-50 group-hover:opacity-100', open && 'opacity-100!')}
              aria-hidden="true"
            />
          </MenuButton>
          <MenuItems
            className="
              absolute right-0 -left-11 mt-1.5 w-60 max-w-80
              origin-top-right divide-y divide-divider-regular rounded-lg bg-components-panel-bg-blur
              shadow-lg outline-hidden
            "
          >
            <div className="overflow-auto px-1 py-1" style={{ maxHeight: '50vh' }} onScroll={handleScroll}>
              {
                navigationItems.map(nav => (
                  <MenuItem key={nav.id}>
                    <div
                      className="flex w-full cursor-pointer items-center truncate rounded-lg px-3 py-[6px] text-[14px] font-normal text-text-secondary hover:bg-state-base-hover"
                      onClick={() => {
                        if (curNav?.id === nav.id)
                          return
                        setAppDetail()
                        router.push(nav.link)
                      }}
                      title={nav.name}
                    >
                      <div className="relative mr-2 h-6 w-6 rounded-md">
                        <AppIcon
                          size="tiny"
                          iconType={nav.icon_type}
                          icon={nav.icon}
                          background={nav.icon_background}
                          imageUrl={nav.icon_url}
                        />
                        {!!nav.mode && (
                          <AppTypeIcon type={nav.mode} wrapperClassName="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 shadow-sm" className="h-2.5 w-2.5" />
                        )}
                      </div>
                      <div className="truncate">
                        {nav.name}
                      </div>
                    </div>
                  </MenuItem>
                ))
              }
              {isLoadingMore && (
                <div className="flex justify-center py-2">
                  <Loading />
                </div>
              )}
            </div>
            {!isApp && isCurrentWorkspaceEditor && (
              <MenuItem as="div" className="w-full p-1">
                <div
                  onClick={() => onCreate('')}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-[6px] hover:bg-state-base-hover',
                  )}
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-background-default">
                    <RiAddLine className="h-4 w-4 text-text-primary" />
                  </div>
                  <div className="grow text-left text-[14px] font-normal text-text-secondary">{createText}</div>
                </div>
              </MenuItem>
            )}
            {isApp && isCurrentWorkspaceEditor && (
              <AppCreateMenu
                createText={createText}
                startFromBlankText={t('newApp.startFromBlank', { ns: 'app' })}
                startFromTemplateText={t('newApp.startFromTemplate', { ns: 'app' })}
                importDSLText={t('importDSL', { ns: 'app' })}
                onCreate={onCreate}
              />
            )}
          </MenuItems>
        </>
      )}
    </Menu>
  )
}

export default NavSelector
