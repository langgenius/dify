'use client'
import type { AppIconType, AppModeEnum } from '@/types/app'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import {
  RiAddLine,
  RiArrowDownSLine,
} from '@remixicon/react'
import { debounce } from 'es-toolkit/compat'
import { useCallback } from 'react'
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
  const handleCreate = (state: string) => {
    onCreate(state)
  }

  return (
    <DropdownMenuSub>
      <div className="p-1">
        <DropdownMenuSubTrigger
          className="h-9 gap-2 px-3 py-[6px]"
        >
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-background-default">
            <span className="i-ri-add-line h-4 w-4 text-text-primary" />
          </div>
          <span className="grow text-left text-[14px] font-normal text-text-secondary">{createText}</span>
        </DropdownMenuSubTrigger>
      </div>
      <DropdownMenuSubContent
        placement="right-start"
        sideOffset={4}
        popupClassName="min-w-[200px] bg-components-panel-bg-blur p-0"
      >
        <div className="p-1">
          <DropdownMenuItem
            className="h-9 px-3 py-[6px] font-normal text-text-secondary"
            onClick={() => handleCreate('blank')}
          >
            <FilePlus01 className="mr-2 h-4 w-4 shrink-0 text-text-secondary" />
            {startFromBlankText}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="h-9 px-3 py-[6px] font-normal text-text-secondary"
            onClick={() => handleCreate('template')}
          >
            <FilePlus02 className="mr-2 h-4 w-4 shrink-0 text-text-secondary" />
            {startFromTemplateText}
          </DropdownMenuItem>
        </div>
        <div className="border-t border-divider-regular p-1">
          <DropdownMenuItem
            className="h-9 px-3 py-[6px] font-normal text-text-secondary"
            onClick={() => handleCreate('dsl')}
          >
            <FileArrow01 className="mr-2 h-4 w-4 shrink-0 text-text-secondary" />
            {importDSLText}
          </DropdownMenuItem>
        </div>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
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
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        className={cn(
          'hover:hover:bg-components-main-nav-nav-button-bg-active-hover group inline-flex h-7 items-center justify-center rounded-[10px] pr-2.5 pl-2 text-[14px] font-semibold text-components-main-nav-nav-button-text-active outline-hidden',
          'focus-visible:bg-components-main-nav-nav-button-bg-active focus-visible:ring-1 focus-visible:ring-components-input-border-hover data-popup-open:bg-components-main-nav-nav-button-bg-active',
        )}
      >
        <div className="max-w-[157px] truncate" title={curNav?.name}>{curNav?.name}</div>
        <RiArrowDownSLine
          className="ml-1 h-3 w-3 shrink-0 opacity-50 group-hover:opacity-100 group-data-popup-open:opacity-100"
          aria-hidden="true"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement="bottom-end"
        sideOffset={6}
        popupClassName="w-60 max-w-80 divide-y divide-divider-regular bg-components-panel-bg-blur p-0"
      >
        <div className="max-h-[50vh] overflow-auto px-1 py-1" onScroll={handleScroll}>
          {
            navigationItems.map(nav => (
              <DropdownMenuItem
                key={nav.id}
                className="h-auto truncate px-3 py-[6px] text-[14px] font-normal text-text-secondary"
                onClick={() => {
                  if (curNav?.id === nav.id)
                    return
                  setAppDetail()
                  router.push(nav.link)
                }}
                title={nav.name}
              >
                <div className="relative mr-2 h-6 w-6 shrink-0 rounded-md">
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
                <div className="min-w-0 truncate">
                  {nav.name}
                </div>
              </DropdownMenuItem>
            ))
          }
          {isLoadingMore && (
            <div className="flex justify-center py-2">
              <Loading />
            </div>
          )}
        </div>
        {!isApp && isCurrentWorkspaceEditor && (
          <div className="p-1">
            <DropdownMenuItem
              className="h-9 gap-2 px-3 py-[6px]"
              onClick={() => onCreate('')}
            >
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-background-default">
                <RiAddLine className="h-4 w-4 text-text-primary" />
              </div>
              <div className="grow text-left text-[14px] font-normal text-text-secondary">{createText}</div>
            </DropdownMenuItem>
          </div>
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
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default NavSelector
