import type { AgentInviteOptionResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { DropdownMenuContentProps } from '@langgenius/dify-ui/dropdown-menu'
import type { ReactNode } from 'react'
import type { NodeDefault } from '../types'
import type { AgentRosterNodeData } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuFilterProvider,
  DropdownMenuInput,
  DropdownMenuInputGroup,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuList,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { createContext, use, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import Badge from '@/app/components/base/badge'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { toast } from '@/app/notifications'
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
    <DropdownMenuFilterProvider filter={null} value={searchText} onValueChange={setSearchText}>
      <DropdownMenu>
        <SearchTextContext value={searchText}>{children}</SearchTextContext>
      </DropdownMenu>
    </DropdownMenuFilterProvider>
  )
}

export const AgentSelectorMenuTrigger = DropdownMenuTrigger

type AgentSelectorMenuContentProps = {
  placement?: DropdownMenuContentProps['placement']
  onSelect: (agent: AgentRosterNodeData) => void
  onStartFromScratch?: () => void
}

export function AgentSelectorMenuContent({
  placement = 'bottom-end',
  onSelect,
  onStartFromScratch,
}: AgentSelectorMenuContentProps) {
  const { t } = useTranslation(['agentRoster'])

  return (
    <DropdownMenuContent
      placement={placement}
      sideOffset={4}
      aria-label={t(($) => $['roster.nodeSelector.dialogLabel'], { ns: 'agentRoster' })}
      className="w-60"
    >
      <AgentSelectorList onSelect={onSelect} onStartFromScratch={onStartFromScratch} />
    </DropdownMenuContent>
  )
}

// Mounted only while the menu is open, so the search runs on demand.
function AgentSelectorList({
  onSelect,
  onStartFromScratch,
}: Pick<AgentSelectorMenuContentProps, 'onSelect' | 'onStartFromScratch'>) {
  const { t } = useTranslation(['workflow', 'common', 'agentRoster'])
  const appId = useHooksStore((s) => s.configsMap?.flowId)
  const searchText = use(SearchTextContext)
  const keyword = useDebounce(searchText.trim(), { wait: 300 })
  const agentsQuery = useQuery({
    ...consoleQuery.agent.inviteOptions.get.queryOptions({
      input: {
        query: {
          limit: AGENT_SELECTOR_PAGE_SIZE,
          page: 1,
          ...(appId ? { app_id: appId } : {}),
          ...(keyword ? { keyword } : {}),
        },
      },
    }),
    staleTime: 0,
    // A new keyword keeps the previous results on screen instead of flashing the skeleton.
    placeholderData: keepPreviousData,
  })
  const agents = agentsQuery.data?.data ?? []
  const isLoading = agentsQuery.isPending
  const statusText = isLoading
    ? t(($) => $.loading, { ns: 'common' })
    : agentsQuery.isError
      ? t(($) => $['roster.loadingError'], { ns: 'agentRoster' })
      : agents.length === 0
        ? keyword
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
      <DropdownMenuInputGroup>
        <span
          aria-hidden
          className="i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
        />
        <DropdownMenuInput
          aria-label={t(($) => $['roster.searchLabel'], { ns: 'agentRoster' })}
          placeholder={t(($) => $['roster.nodeSelector.searchPlaceholder'], { ns: 'agentRoster' })}
        />
      </DropdownMenuInputGroup>
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
      {/* The agents scroll inside the list so the footer actions stay in view. The scroller is kept
          out of the tab order: the menu owns focus and Tab closes it. */}
      <DropdownMenuList className="flex max-h-none flex-col overflow-visible">
        <div
          tabIndex={-1}
          className={cn(
            'max-h-54 min-h-0 overflow-y-auto overscroll-contain outline-hidden',
            agentsQuery.isPlaceholderData && 'opacity-60',
          )}
        >
          {isLoading ? (
            <AgentSelectorLoadingSkeleton />
          ) : (
            !agentsQuery.isError &&
            agents.map((agent) => (
              <DropdownMenuItem
                key={agent.id}
                closeOnClick={Boolean(agent.active_config_snapshot_id)}
                className="h-auto gap-2 py-1.5 pr-3 pl-2"
                onClick={() => handleSelect(agent)}
              >
                <span aria-hidden className="shrink-0">
                  <AppIcon
                    size="small"
                    iconType={agent.icon_type}
                    icon={agent.icon ?? undefined}
                    background={agent.icon_background}
                    imageUrl={agent.icon ?? undefined}
                  />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate system-sm-medium text-text-secondary">
                    {agent.name}
                  </span>
                  <span className="truncate system-xs-regular text-text-tertiary">
                    {agent.role || agent.description}
                  </span>
                </span>
              </DropdownMenuItem>
            ))
          )}
        </div>
        <DropdownMenuSeparator className="shrink-0" />
        {onStartFromScratch && (
          <DropdownMenuItem className="shrink-0" onClick={onStartFromScratch}>
            <span aria-hidden className="i-ri-add-line size-4 shrink-0 text-text-tertiary" />
            <span className="min-w-0 flex-1 truncate">
              {t(($) => $['roster.nodeSelector.startFromScratch'], { ns: 'agentRoster' })}
            </span>
          </DropdownMenuItem>
        )}
        <DropdownMenuLinkItem
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
        </DropdownMenuLinkItem>
      </DropdownMenuList>
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
              'flex items-center gap-2 py-1.5 pr-3 pl-2 opacity-20',
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
            className="w-full justify-start gap-0 px-3 text-left data-popup-open:bg-state-base-hover"
          />
        }
      >
        <BlockIcon className="mr-2 shrink-0" type={block.metaData.type} />
        <span className="min-w-0 grow truncate system-sm-medium text-text-secondary">
          {block.metaData.title}
        </span>
        <Badge
          size="xs"
          variant="dimm"
          text={t(($) => $['menus.status'], { ns: 'navigation' })}
          className="ml-2 shrink-0"
        />
        <span
          aria-hidden
          className="i-custom-vender-solid-general-arrow-down-round-fill size-4 shrink-0 -rotate-90 text-text-tertiary"
        />
      </AgentSelectorMenuTrigger>
      <AgentSelectorMenuContent
        placement="right-start"
        onSelect={onSelect}
        onStartFromScratch={onStartFromScratch}
      />
    </AgentSelectorMenu>
  )
}
