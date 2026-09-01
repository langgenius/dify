import type { AgentInviteOptionResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { ComboboxChangeEventDetails } from '@langgenius/dify-ui/combobox'
import type { NodeDefault } from '../types'
import type { AgentRosterNodeData } from './types'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Combobox,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxItemText,
  ComboboxList,
  ComboboxStatus,
} from '@langgenius/dify-ui/combobox'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { toast } from '@langgenius/dify-ui/toast'
import { useQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import Badge from '@/app/components/base/badge'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { useCanManageAgents } from '@/features/agent-v2/permissions'
import Link from '@/next/link'
import { consoleQuery } from '@/service/client'
import BlockIcon from '../block-icon'

const AGENT_SELECTOR_PAGE_SIZE = 8

export function AgentSelectorContent({
  open,
  onOpenChange,
  onSelect,
  onStartFromScratch,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (agent: AgentRosterNodeData) => void
  onStartFromScratch?: () => void
}) {
  const { t } = useTranslation(['agentV2', 'common', 'workflow'])
  const appId = useHooksStore((s) => s.configsMap?.flowId)
  const [searchText, setSearchText] = useState('')
  const debouncedSearchText = useDebounce(searchText.trim(), { wait: 300 })
  const agentsQuery = useQuery({
    ...consoleQuery.agent.inviteOptions.get.queryOptions({
      input: {
        query: {
          limit: AGENT_SELECTOR_PAGE_SIZE,
          page: 1,
          ...(appId ? { app_id: appId } : {}),
          ...(debouncedSearchText ? { keyword: debouncedSearchText } : {}),
        },
      },
    }),
    staleTime: 0,
  })
  const agents = agentsQuery.data?.data ?? []
  const canManageAgents = useCanManageAgents()
  const handleInputValueChange = (nextSearchText: string, details: ComboboxChangeEventDetails) => {
    if (details.reason !== 'item-press') setSearchText(nextSearchText)
  }
  const handleValueChange = (agent: AgentInviteOptionResponse | null) => {
    if (!agent) return
    if (!agent.active_config_snapshot_id) {
      toast.error(t(($) => $['nodes.agent.modelNotSelected'], { ns: 'workflow' }))
      return
    }

    onSelect(toAgentRosterNodeData(agent))
  }
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) onOpenChange(false)
  }
  const isLoading = agentsQuery.isPending
  const statusText = isLoading
    ? t(($) => $.loading, { ns: 'common' })
    : agentsQuery.isError
      ? t(($) => $['roster.loadingError'], { ns: 'agentV2' })
      : agents.length === 0
        ? debouncedSearchText
          ? t(($) => $['roster.emptySearch'], { ns: 'agentV2' })
          : t(($) => $['roster.empty'], { ns: 'agentV2' })
        : null
  const hasActions = !!onStartFromScratch || canManageAgents

  return (
    <div className="w-60 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-sm">
      <Combobox<AgentInviteOptionResponse>
        filter={null}
        inline
        inputValue={searchText}
        items={agents}
        itemToStringLabel={(agent) => agent.name}
        itemToStringValue={(agent) => agent.id}
        open={open}
        value={null}
        onInputValueChange={handleInputValueChange}
        onOpenChange={handleOpenChange}
        onValueChange={handleValueChange}
      >
        <div className="bg-components-panel-bg-blur p-2 pb-1">
          <ComboboxInputGroup className="h-8 min-h-8 px-2">
            <span
              aria-hidden
              className="mr-0.5 i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
            />
            <ComboboxInput
              aria-label={t(($) => $['roster.searchLabel'], { ns: 'agentV2' })}
              placeholder={t(($) => $['roster.nodeSelector.searchPlaceholder'], { ns: 'agentV2' })}
              className="block h-4.5 grow px-1 py-0 system-sm-regular text-components-input-text-filled"
            />
          </ComboboxInputGroup>
        </div>
        <ComboboxStatus className="system-xs-regular">{statusText}</ComboboxStatus>
        {isLoading ? (
          <div className="max-h-54 overflow-hidden p-1">
            <AgentSelectorLoadingSkeleton />
          </div>
        ) : (
          <ComboboxList className="max-h-54 p-1 focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-state-accent-solid focus-visible:outline-solid">
            {!agentsQuery.isError &&
              agents.map((agent) => <AgentSelectorItem key={agent.id} agent={agent} />)}
          </ComboboxList>
        )}
        {hasActions && (
          <div className="border-t border-divider-subtle p-1">
            {onStartFromScratch && (
              <Button
                variant="ghost"
                size="medium"
                className="h-7 w-full justify-start gap-2 rounded-md px-2 py-1.5 text-left system-sm-regular text-text-secondary"
                onClick={onStartFromScratch}
              >
                <span aria-hidden className="i-ri-add-line size-4 shrink-0 text-text-tertiary" />
                <span className="min-w-0 flex-1 truncate">
                  {t(($) => $['roster.nodeSelector.startFromScratch'], { ns: 'agentV2' })}
                </span>
              </Button>
            )}
            {canManageAgents && (
              <Link
                href="/agents"
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  buttonVariants({ variant: 'ghost', size: 'medium' }),
                  'h-7 w-full justify-start gap-2 rounded-md px-2 py-1.5 text-left system-sm-regular text-text-secondary',
                )}
                onClick={() => onOpenChange(false)}
              >
                <span
                  aria-hidden
                  className="i-ri-arrow-right-up-line size-4 shrink-0 text-text-tertiary"
                />
                <span className="min-w-0 flex-1 truncate">
                  {t(($) => $['roster.nodeSelector.manageInAgentConsole'], { ns: 'agentV2' })}
                </span>
              </Link>
            )}
          </div>
        )}
      </Combobox>
    </div>
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

function AgentSelectorAvatar({ agent }: { agent: AgentInviteOptionResponse }) {
  return (
    <AppIcon
      size="small"
      iconType={agent.icon_type}
      icon={agent.icon ?? undefined}
      background={agent.icon_background}
      imageUrl={agent.icon ?? undefined}
    />
  )
}

function AgentSelectorItem({ agent }: { agent: AgentInviteOptionResponse }) {
  return (
    <ComboboxItem value={agent} className="grid-cols-[1fr] gap-0 py-1.5 pr-3 pl-2">
      <ComboboxItemText className="flex items-center gap-2 px-0">
        <span aria-hidden className="shrink-0">
          <AgentSelectorAvatar agent={agent} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate system-sm-medium text-text-secondary">{agent.name}</span>
          <span className="truncate system-xs-regular text-text-tertiary">
            {agent.role || agent.description}
          </span>
        </span>
      </ComboboxItemText>
    </ComboboxItem>
  )
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
  const { t } = useTranslation(['agentV2', 'common'])
  const [open, setOpen] = useState(false)
  const handleSelect = (agent: AgentRosterNodeData) => {
    setOpen(false)
    onSelect(agent)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        openOnHover
        render={
          <Button
            variant="ghost"
            size="medium"
            className="w-full justify-start gap-0 px-3 text-left data-popup-open:bg-state-base-hover"
          >
            <BlockIcon className="mr-2 shrink-0" type={block.metaData.type} />
            <span className="min-w-0 grow truncate system-sm-medium text-text-secondary">
              {block.metaData.title}
            </span>
            <Badge
              size="xs"
              variant="dimm"
              text={t(($) => $['menus.status'], { ns: 'common' })}
              className="ml-2 shrink-0"
            />
            <span
              aria-hidden
              className="i-custom-vender-solid-general-arrow-down-round-fill size-4 shrink-0 -rotate-90 text-text-tertiary"
            />
          </Button>
        }
      />
      <PopoverContent
        placement="right-start"
        sideOffset={4}
        className="border-none bg-transparent p-0 shadow-none backdrop-blur-none"
      >
        <PopoverTitle className="sr-only">
          {t(($) => $['roster.nodeSelector.dialogLabel'], { ns: 'agentV2' })}
        </PopoverTitle>
        <AgentSelectorContent
          open={open}
          onOpenChange={setOpen}
          onSelect={handleSelect}
          onStartFromScratch={() => {
            setOpen(false)
            onStartFromScratch()
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
