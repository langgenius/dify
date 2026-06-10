import type { AgentInviteOptionResponse } from '@dify/contracts/api/console/agents/types.gen'
import type { ComboboxRootChangeEventDetails } from '@langgenius/dify-ui/combobox'
import type { NodeDefault } from '../types'
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

function AgentSelectorContent({
  onSelect,
}: {
  onSelect: () => void
}) {
  const { t } = useTranslation(['agentV2', 'common'])
  const appId = useHooksStore(s => s.configsMap?.flowId)
  const [searchText, setSearchText] = useState('')
  const debouncedSearchText = useDebounce(searchText.trim(), { wait: 300 })
  const agentsQuery = useQuery({
    ...consoleQuery.agents.inviteOptions.get.queryOptions({
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

    onSelect()
  }

  return (
    <div className="w-90 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-sm">
      <Combobox<AgentInviteOptionResponse>
        filter={null}
        inputValue={searchText}
        items={agents}
        itemToStringLabel={getAgentLabel}
        itemToStringValue={getAgentValue}
        open
        value={null}
        onInputValueChange={handleInputValueChange}
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
          {agentsQuery.isPending && (
            <ComboboxStatus className="px-3 py-2 system-xs-regular">
              {t('loading', { ns: 'common' })}
            </ComboboxStatus>
          )}
          {!agentsQuery.isPending && agentsQuery.isError && (
            <ComboboxStatus className="px-3 py-2 system-xs-regular">
              {t('roster.loadingError', { ns: 'agentV2' })}
            </ComboboxStatus>
          )}
          {!agentsQuery.isPending && !agentsQuery.isError && (
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
      <div className="border-t border-divider-subtle px-4 py-2">
        <Link
          href="/roster"
          className="inline-flex items-center gap-0.5 rounded-sm system-xs-medium text-text-tertiary hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        >
          {t('roster.nodeSelector.manageInAgentConsole', { ns: 'agentV2' })}
          <span aria-hidden className="i-ri-arrow-right-up-line size-3" />
        </Link>
      </div>
    </div>
  )
}

function getAgentLabel(agent: AgentInviteOptionResponse) {
  return agent.name
}

function getAgentValue(agent: AgentInviteOptionResponse) {
  return agent.id
}

function AgentSelectorItem({
  agent,
}: {
  agent: AgentInviteOptionResponse
}) {
  const imageUrl = (agent.icon_type === 'image' || agent.icon_type === 'link') ? agent.icon : undefined
  const iconType = imageUrl ? 'image' : agent.icon_type

  return (
    <ComboboxItem
      value={agent}
      className="grid-cols-[1fr] gap-0 py-1.5 pr-3 pl-2"
    >
      <ComboboxItemText className="flex items-center gap-2 px-0">
        <span aria-hidden className="shrink-0">
          <AppIcon
            size="small"
            rounded
            iconType={iconType}
            icon={agent.icon ?? undefined}
            background={agent.icon_background}
            imageUrl={imageUrl}
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate system-sm-medium text-text-secondary">
            {agent.name}
          </span>
          <span className="truncate system-xs-regular text-text-tertiary">
            {agent.description}
          </span>
        </span>
      </ComboboxItemText>
    </ComboboxItem>
  )
}

export function AgentBlockItem({
  block,
  onSelect,
}: {
  block: NodeDefault
  onSelect: () => void
}) {
  const { t } = useTranslation('agentV2')
  const [open, setOpen] = useState(false)
  const handleSelect = () => {
    setOpen(false)
    onSelect()
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
            <span aria-hidden className="i-ri-arrow-down-s-fill size-4 shrink-0 -rotate-90 text-text-tertiary" />
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
        <AgentSelectorContent onSelect={handleSelect} />
      </PopoverContent>
    </Popover>
  )
}
