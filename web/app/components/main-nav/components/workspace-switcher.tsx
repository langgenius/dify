'use client'

import type { IWorkspace } from '@/models/common'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRadioItemIndicator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useMemo, useState } from 'react'
import { useTranslation } from '#i18n'
import { SearchInput } from '@/app/components/base/search-input'
import { WorkspaceIcon, WorkspaceMenuItemContent } from './workspace-menu-content'

const workspaceSwitchActionButtonClassName = 'flex shrink-0 items-center justify-center rounded-md p-0.5 text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid'
const workspaceSwitchActionIconWrapClassName = 'flex size-5 shrink-0 items-center justify-center'
const workspaceSwitchActionIconClassName = 'size-3.5 shrink-0'
const workspaceSwitchListClassName = 'max-h-[240px] overflow-y-auto overscroll-contain scroll-py-1'
const workspaceSwitchI18nKey = (key: string) => key as 'mainNav.workspace.settings'
type WorkspaceSort = 'lastOpened' | 'createdAt'

const getWorkspaceLastOpenedAt = (workspace: IWorkspace) => workspace.last_opened_at ?? 0

function WorkspaceSwitchControls({
  searchText,
  sort,
  onSearchTextChange,
  onSortChange,
}: {
  searchText: string
  sort: WorkspaceSort
  onSearchTextChange: (value: string) => void
  onSortChange: (value: WorkspaceSort) => void
}) {
  const { t } = useTranslation()
  const [searchVisible, setSearchVisible] = useState(false)
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const sortMenuLabel = t(workspaceSwitchI18nKey('mainNav.workspace.sort.openMenu'), { ns: 'common' })
  const sortOptions: Array<{ value: WorkspaceSort, label: string }> = [
    { value: 'lastOpened', label: t(workspaceSwitchI18nKey('mainNav.workspace.sort.lastOpened'), { ns: 'common' }) },
    { value: 'createdAt', label: t(workspaceSwitchI18nKey('mainNav.workspace.sort.createdTime'), { ns: 'common' }) },
  ]

  return (
    <>
      <div className="flex items-start gap-0.5 py-1 pr-2 pl-3">
        <div className="flex min-w-0 flex-1 items-center justify-center py-1">
          <span className="min-w-0 flex-1 truncate system-xs-medium-uppercase text-text-tertiary">
            {t('userProfile.workspace', { ns: 'common' })}
          </span>
        </div>
        <DropdownMenu open={sortMenuOpen} onOpenChange={setSortMenuOpen}>
          <DropdownMenuTrigger
            aria-label={sortMenuLabel}
            className={cn(
              workspaceSwitchActionButtonClassName,
              sortMenuOpen && 'bg-state-base-hover text-text-secondary',
            )}
          >
            <span aria-hidden className={workspaceSwitchActionIconWrapClassName}>
              <span className={cn('i-ri-sort-desc', workspaceSwitchActionIconClassName)} />
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            placement="bottom-end"
            sideOffset={4}
            popupClassName="w-40 bg-components-panel-bg-blur! p-1! backdrop-blur-[5px]"
          >
            <DropdownMenuRadioGroup
              value={sort}
              onValueChange={(value) => {
                onSortChange(value as WorkspaceSort)
                setSortMenuOpen(false)
              }}
            >
              {sortOptions.map(option => (
                <DropdownMenuRadioItem key={option.value} value={option.value} className="mx-0 h-8 gap-1 px-2 py-1">
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    <DropdownMenuRadioItemIndicator className="ml-0" />
                  </span>
                  <span className="min-w-0 flex-1 truncate px-1 system-md-regular text-text-secondary">
                    {option.label}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          aria-label={t('operation.search', { ns: 'common' })}
          className={cn(
            workspaceSwitchActionButtonClassName,
            searchVisible && 'bg-state-base-hover text-text-secondary',
          )}
          onClick={() => setSearchVisible(visible => !visible)}
        >
          <span aria-hidden className={workspaceSwitchActionIconWrapClassName}>
            <span className={cn('i-ri-search-line', workspaceSwitchActionIconClassName)} />
          </span>
        </button>
      </div>
      {searchVisible && (
        <div className="px-2 pb-2">
          <SearchInput
            value={searchText}
            onValueChange={onSearchTextChange}
            placeholder={t(workspaceSwitchI18nKey('mainNav.workspace.searchPlaceholder'), { ns: 'common' })}
            autoFocus
          />
        </div>
      )}
    </>
  )
}

type WorkspaceSwitcherProps = {
  workspaces: IWorkspace[]
  onSwitchWorkspace: (workspaceId: string) => void
}

export function WorkspaceSwitcher({
  workspaces,
  onSwitchWorkspace,
}: WorkspaceSwitcherProps) {
  const [workspaceSearchText, setWorkspaceSearchText] = useState('')
  const [workspaceSort, setWorkspaceSort] = useState<WorkspaceSort>('lastOpened')
  const displayedWorkspaces = useMemo(() => {
    const normalizedSearchText = workspaceSearchText.trim().toLowerCase()
    const filteredWorkspaces = normalizedSearchText
      ? workspaces.filter(workspace => workspace.name.toLowerCase().includes(normalizedSearchText))
      : [...workspaces]

    if (workspaceSort === 'createdAt')
      return filteredWorkspaces.sort((a, b) => b.created_at - a.created_at)

    return filteredWorkspaces.sort((a, b) => {
      return getWorkspaceLastOpenedAt(b) - getWorkspaceLastOpenedAt(a)
        || b.created_at - a.created_at
    })
  }, [workspaceSearchText, workspaceSort, workspaces])

  return (
    <>
      <WorkspaceSwitchControls
        searchText={workspaceSearchText}
        sort={workspaceSort}
        onSearchTextChange={setWorkspaceSearchText}
        onSortChange={setWorkspaceSort}
      />
      <div className={workspaceSwitchListClassName}>
        {displayedWorkspaces.map(workspace => (
          <button
            type="button"
            key={workspace.id}
            aria-current={workspace.current ? 'true' : undefined}
            title={workspace.name}
            className={cn(
              'flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-1 text-left outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-inset',
              workspace.current && 'bg-state-base-hover',
            )}
            onClick={() => {
              onSwitchWorkspace(workspace.id)
            }}
          >
            <WorkspaceMenuItemContent
              icon={<WorkspaceIcon name={workspace.name} className="h-5 w-5 rounded-md" />}
              label={workspace.name}
              trailing={workspace.current ? <span aria-hidden className="i-ri-check-line h-4 w-4 text-text-accent" /> : undefined}
            />
          </button>
        ))}
      </div>
    </>
  )
}
