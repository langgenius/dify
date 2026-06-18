import type { AgentInviteOptionResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { ComboboxRootChangeEventDetails } from '@langgenius/dify-ui/combobox'
import type { NodeDefault } from '../types'
import type { AgentRosterNodeData } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxItemText,
  ComboboxList,
  ComboboxStatus,
} from '@langgenius/dify-ui/combobox'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { toast } from '@langgenius/dify-ui/toast'
import { useQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
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
  const appId = useHooksStore(s => s.configsMap?.flowId)
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
  })
  const agents = agentsQuery.data?.data ?? []
  const handleInputValueChange = (nextSearchText: string, details: ComboboxRootChangeEventDetails) => {
    if (details.reason !== 'item-press')
      setSearchText(nextSearchText)
  }
  const handleValueChange = (agent: AgentInviteOptionResponse | null) => {
    if (!agent)
      return

    if (!agent.active_config_snapshot_id) {
      toast.error(t('nodes.agent.modelNotSelected', { ns: 'workflow' }))
      return
    }

    onSelect(toAgentRosterNodeData(agent))
  }
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen)
      onOpenChange(false)
  }
  const isLoading = agentsQuery.isPending

  return (
    <div className="w-60 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-sm">
      <Combobox<AgentInviteOptionResponse>
        filter={null}
        inputValue={searchText}
        items={agents}
        itemToStringLabel={getAgentLabel}
        itemToStringValue={getAgentValue}
        open={open}
        value={null}
        onInputValueChange={handleInputValueChange}
        onOpenChange={handleOpenChange}
        onValueChange={handleValueChange}
      >
        <div className="bg-components-panel-bg-blur p-2 pb-1">
          <ComboboxInputGroup className="h-8 min-h-8 px-2">
            <span aria-hidden className="mr-0.5 i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder" />
            <ComboboxInput
              aria-label={t('roster.searchLabel', { ns: 'agentV2' })}
              placeholder={t('roster.nodeSelector.searchPlaceholder', { ns: 'agentV2' })}
              className="block h-4.5 grow px-1 py-0 system-sm-regular text-components-input-text-filled"
            />
          </ComboboxInputGroup>
        </div>
        <div className="max-h-54 overflow-y-auto p-1">
          {isLoading && (
            <AgentSelectorLoadingSkeleton label={t('loading', { ns: 'common' })} />
          )}
          {!isLoading && agentsQuery.isError && (
            <ComboboxStatus className="px-3 py-2 system-xs-regular">
              {t('roster.loadingError', { ns: 'agentV2' })}
            </ComboboxStatus>
          )}
          {!isLoading && !agentsQuery.isError && (
            <>
              <ComboboxList className="max-h-none overflow-visible p-0">
                {(agent: AgentInviteOptionResponse) => (
                  <AgentSelectorItem key={agent.id} agent={agent} />
                )}
              </ComboboxList>
              <ComboboxEmpty className="px-3 py-2 system-xs-regular">
                {debouncedSearchText
                  ? t('roster.emptySearch', { ns: 'agentV2' })
                  : t('roster.empty', { ns: 'agentV2' })}
              </ComboboxEmpty>
            </>
          )}
        </div>
      </Combobox>
      <div className="border-t border-divider-subtle p-1">
        {onStartFromScratch && (
          <button
            type="button"
            className="flex min-h-7 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left system-sm-regular text-text-secondary hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            onClick={onStartFromScratch}
          >
            <span aria-hidden className="i-ri-add-line size-4 shrink-0 text-text-tertiary" />
            <span className="min-w-0 flex-1 truncate">
              {t('roster.nodeSelector.startFromScratch', { ns: 'agentV2' })}
            </span>
          </button>
        )}
        <Link
          href="/roster"
          className="flex min-h-7 w-full items-center gap-2 rounded-md px-2 py-1.5 system-sm-regular text-text-secondary hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        >
          <span aria-hidden className="i-ri-arrow-right-up-line size-4 shrink-0 text-text-tertiary" />
          <span className="min-w-0 flex-1 truncate">
            {t('roster.nodeSelector.manageInAgentConsole', { ns: 'agentV2' })}
          </span>
        </Link>
      </div>
    </div>
  )
}

function AgentSelectorLoadingSkeleton({
  label,
}: {
  label: string
}) {
  return (
    <ComboboxStatus className="p-0">
      <span className="sr-only">{label}</span>
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
    </ComboboxStatus>
  )
}

function getAgentLabel(agent: AgentInviteOptionResponse) {
  return agent.name
}

function getAgentValue(agent: AgentInviteOptionResponse) {
  return agent.id
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

function AgentSelectorAvatar({
  agent,
}: {
  agent: AgentInviteOptionResponse
}) {
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

function AgentSelectorItem({
  agent,
}: {
  agent: AgentInviteOptionResponse
}) {
  return (
    <ComboboxItem
      value={agent}
      className="grid-cols-[1fr] gap-0 py-1.5 pr-3 pl-2"
    >
      <ComboboxItemText className="flex items-center gap-2 px-0">
        <span aria-hidden className="shrink-0">
          <AgentSelectorAvatar agent={agent} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate system-sm-medium text-text-secondary">
            {agent.name}
          </span>
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
  const { t } = useTranslation('agentV2')
  const [open, setOpen] = useState(false)
  const handleSelect = (agent: AgentRosterNodeData) => {
    setOpen(false)
    onSelect(agent)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        openOnHover
        render={(
          <button
            type="button"
            className="flex h-8 w-full cursor-pointer items-center rounded-lg px-3 text-left hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden data-popup-open:bg-state-base-hover"
          >
            <BlockIcon
              className="mr-2 shrink-0"
              type={block.metaData.type}
            />
            <span className="min-w-0 grow truncate system-sm-medium text-text-secondary">
              {block.metaData.title}
            </span>
            <span aria-hidden className="i-custom-vender-solid-general-arrow-down-round-fill size-4 shrink-0 -rotate-90 text-text-tertiary" />
          </button>
        )}
      />
      <PopoverContent
        placement="right-start"
        sideOffset={4}
        popupClassName="border-none bg-transparent p-0 shadow-none backdrop-blur-none"
      >
        <PopoverTitle className="sr-only">
          {t('roster.nodeSelector.dialogLabel')}
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
