import type { AgentInviteOptionResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { MenuContentProps } from '@langgenius/dify-ui/menu'
import type { ReactNode } from 'react'
import type { NodeDefault } from '../types'
import type { AgentRosterNodeData } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { InputGroupAddon } from '@langgenius/dify-ui/input-group'
import {
  Menu,
  MenuClear,
  MenuContent,
  MenuFilterProvider,
  MenuInput,
  MenuInputGroup,
  MenuItem,
  MenuLinkItem,
  MenuList,
  MenuSeparator,
  MenuTrigger,
} from '@langgenius/dify-ui/menu'
import { Separator } from '@langgenius/dify-ui/separator'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useAtomValue } from 'jotai'
import { createContext, use, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import Badge from '@/app/components/base/badge'
import { editorAppIdAtom } from '@/app/components/workflow/editor-resource/state'
import { toast } from '@/app/notifications'
import { CompactTagFilter } from '@/features/tag-management/tag-filter'
import Link from '@/next/link'
import { consoleQuery } from '@/service/console'
import BlockIcon from '../block-icon'

const AGENT_SELECTOR_PAGE_SIZE = 8

// The filter query doubles as the server search keyword, so the root keeps it controlled and the
// content reads it from here.
const SearchTextContext = createContext('')

// A menu of roster agents. Choosing one is an action for the host, inserting a node or switching a
// node's binding; the menu holds no selection of its own. Compose `AgentSelectorMenuTrigger` and
// `AgentSelectorMenuContent` inside it.
export function AgentSelectorMenu({ children }: { children: ReactNode }) {
  const [searchText, setSearchText] = useState('')

  return (
    <MenuFilterProvider filter={null} value={searchText} onValueChange={setSearchText}>
      <Menu>
        <SearchTextContext value={searchText}>{children}</SearchTextContext>
      </Menu>
    </MenuFilterProvider>
  )
}

export const AgentSelectorMenuTrigger = MenuTrigger

type AgentSelectorMenuContentProps = Pick<MenuContentProps, 'side' | 'align'> & {
  onSelect: (agent: AgentRosterNodeData) => void
  onStartFromScratch?: () => void
}

export function AgentSelectorMenuContent({
  side,
  align,
  onSelect,
  onStartFromScratch,
}: AgentSelectorMenuContentProps) {
  const { t } = useTranslation(['agentRoster'])

  return (
    <MenuContent
      side={side}
      align={align}
      aria-label={t(($) => $['roster.nodeSelector.dialogLabel'], { ns: 'agentRoster' })}
      className="w-80 max-w-(--available-width) not-[[role=menu]]:overflow-visible"
    >
      <AgentSelectorList onSelect={onSelect} onStartFromScratch={onStartFromScratch} />
    </MenuContent>
  )
}

// Mounted only while the menu is open, so the search runs on demand.
function AgentSelectorList({
  onSelect,
  onStartFromScratch,
}: Pick<AgentSelectorMenuContentProps, 'onSelect' | 'onStartFromScratch'>) {
  const { t } = useTranslation(['workflow', 'common', 'agentRoster'])
  const appId = useAtomValue(editorAppIdAtom)
  const searchText = use(SearchTextContext)
  const keyword = useDebounce(searchText.trim(), { wait: 300 })
  const [tagIds, setTagIds] = useState<string[]>([])
  const tagPortalRef = useRef<HTMLDivElement>(null)
  const agentsQuery = useInfiniteQuery(
    consoleQuery.agent.inviteOptions.get.infiniteOptions({
      input: (page: number) => ({
        query: {
          limit: AGENT_SELECTOR_PAGE_SIZE,
          page,
          ...(appId ? { app_id: appId } : {}),
          ...(keyword ? { keyword } : {}),
          ...(tagIds.length ? { tag_ids: tagIds } : {}),
        },
      }),
      initialPageParam: 1,
      getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
    }),
  )
  const agents = agentsQuery.data?.pages.flatMap((page) => page.data) ?? []
  const isLoading = agentsQuery.isPending
  const statusText = isLoading
    ? t(($) => $.loading, { ns: 'common' })
    : agentsQuery.isError
      ? t(($) => $['roster.loadingError'], { ns: 'agentRoster' })
      : agents.length === 0
        ? keyword || tagIds.length
          ? t(($) => $['roster.emptySearch'], { ns: 'agentRoster' })
          : t(($) => $['roster.empty'], { ns: 'agentRoster' })
        : null

  const handleSelect = (agent: AgentInviteOptionResponse) => {
    if (!agent.active_config_snapshot_id) {
      toast.error(t(($) => $['nodes.agent.modelNotSelected'], { ns: 'workflow' }))
      return
    }
    onSelect(toAgentRosterNodeData(agent))
  }

  return (
    <>
      <MenuInputGroup className="mx-2 mt-1 mb-2 min-w-0 gap-0 px-0">
        <MenuInput
          aria-label={t(($) => $['roster.searchLabel'], { ns: 'agentRoster' })}
          placeholder={t(($) => $['roster.nodeSelector.searchPlaceholder'], { ns: 'agentRoster' })}
        />
        <InputGroupAddon className="ps-1.75 pe-1.25">
          <span
            aria-hidden
            className="i-ri-search-line size-4 text-components-input-text-placeholder"
          />
        </InputGroupAddon>
        <InputGroupAddon align="inline-end" className="gap-1 ps-0.75 pe-0.5">
          <MenuClear />
          <Separator decorative orientation="vertical" className="h-3.5" />
          <CompactTagFilter
            type="agent"
            value={tagIds}
            onChange={setTagIds}
            container={tagPortalRef}
          />
        </InputGroupAddon>
      </MenuInputGroup>
      {/* A persistent live region announces reliably. The skeleton already shows loading, so that
          status is announced but not displayed. */}
      <div
        role="status"
        className={cn(
          'px-3 py-2 system-sm-regular text-text-tertiary empty:p-0',
          isLoading && 'sr-only',
        )}
      >
        {statusText}
      </div>
      {/* Only candidates scroll; the search, filters, and footer actions stay in view. */}
      <MenuList className="flex max-h-none flex-col overflow-visible">
        <div
          tabIndex={-1}
          className="max-h-54 min-h-0 overflow-y-auto overscroll-contain outline-hidden"
        >
          {isLoading ? (
            <AgentSelectorLoadingSkeleton />
          ) : (
            agents.map((agent) => (
              <MenuItem
                key={agent.id}
                closeOnClick={Boolean(agent.active_config_snapshot_id)}
                className="h-auto gap-2 py-1.5 ps-2 pe-3"
                onClick={() => handleSelect(agent)}
              >
                <span aria-hidden className="shrink-0">
                  <AppIcon size="small" icon={{ ...agent, icon_url: agent.icon }} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate system-sm-medium text-text-secondary">
                    {agent.name}
                  </span>
                  <span className="truncate system-xs-regular text-text-tertiary">
                    {agent.role || agent.description}
                  </span>
                </span>
              </MenuItem>
            ))
          )}
          {agentsQuery.hasNextPage && (
            <MenuItem
              closeOnClick={false}
              disabled={agentsQuery.isFetching}
              onClick={() => void agentsQuery.fetchNextPage()}
            >
              {agentsQuery.isFetchingNextPage
                ? t(($) => $.loading, { ns: 'common' })
                : t(($) => $['roster.loadMore'], { ns: 'agentRoster' })}
            </MenuItem>
          )}
        </div>
        <MenuSeparator className="shrink-0" />
        {onStartFromScratch && (
          <MenuItem className="shrink-0" onClick={onStartFromScratch}>
            <span aria-hidden className="i-ri-add-line size-4 shrink-0 text-text-tertiary" />
            <span className="min-w-0 flex-1 truncate">
              {t(($) => $['roster.nodeSelector.startFromScratch'], { ns: 'agentRoster' })}
            </span>
          </MenuItem>
        )}
        <MenuLinkItem
          className="shrink-0"
          render={<Link href="/agents" target="_blank" rel="noopener noreferrer" />}
        >
          <span
            aria-hidden
            className="i-ri-arrow-right-up-line size-4 shrink-0 text-text-tertiary"
          />
          <span className="min-w-0 flex-1 truncate">
            {t(($) => $['roster.nodeSelector.manageInAgentConsole'], { ns: 'agentRoster' })}
          </span>
        </MenuLinkItem>
      </MenuList>
      {/* Keep the tag popup inside the hover menu, after the items it needs to cover. */}
      <div ref={tagPortalRef} />
    </>
  )
}

function AgentSelectorLoadingSkeleton() {
  return (
    <div className="relative overflow-hidden" aria-hidden>
      <div className="p-1">
        {['skeleton-1', 'skeleton-2', 'skeleton-3', 'skeleton-4'].map((key, index) => (
          <div
            key={key}
            className={cn(
              'flex items-center gap-2 py-1.5 ps-2 pe-3 opacity-20',
              index === 3 && 'opacity-10',
            )}
          >
            <div className="size-8 shrink-0 rounded-full bg-text-quaternary" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="h-2 w-20 rounded-xs bg-text-quaternary" />
              <div className="h-2 w-28 rounded-xs bg-text-quaternary" />
            </div>
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-0 bg-linear-to-b from-components-panel-bg-transparent to-background-default-subtle" />
    </div>
  )
}

function toAgentRosterNodeData(agent: AgentInviteOptionResponse): AgentRosterNodeData {
  return {
    description: agent.description,
    icon: agent.icon,
    icon_background: agent.icon_background,
    icon_type: agent.icon_type,
    id: agent.id,
    name: agent.name,
    role: agent.role,
  }
}

export function AgentBlockItem({
  block,
  onSelect,
  onStartFromScratch,
}: {
  block: NodeDefault
  onSelect: (agent: AgentRosterNodeData) => void
  onStartFromScratch: () => void
}) {
  const { t } = useTranslation(['navigation'])

  return (
    <AgentSelectorMenu>
      <AgentSelectorMenuTrigger
        openOnHover
        render={
          <Button
            variant="ghost"
            size="medium"
            className="w-full justify-start gap-0 px-3 text-start data-popup-open:bg-state-base-hover"
          />
        }
      >
        <BlockIcon className="me-2 shrink-0" type={block.metaData.type} />
        <span className="min-w-0 grow truncate system-sm-medium text-text-secondary">
          {block.metaData.title}
        </span>
        <Badge
          size="xs"
          variant="dimm"
          text={t(($) => $['menus.status'], { ns: 'navigation' })}
          className="ms-2 shrink-0"
        />
        <span
          aria-hidden
          className="i-custom-vender-solid-general-arrow-down-round-fill size-4 shrink-0 -rotate-90 text-text-tertiary"
        />
      </AgentSelectorMenuTrigger>
      <AgentSelectorMenuContent
        side="right"
        align="start"
        onSelect={onSelect}
        onStartFromScratch={onStartFromScratch}
      />
    </AgentSelectorMenu>
  )
}
