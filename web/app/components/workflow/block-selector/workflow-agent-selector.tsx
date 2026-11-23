import type { AgentInviteOptionResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentRosterNodeData } from './types'
import type { ExternalAgentWorkflowPreviewAgent } from '@/features/agent-v2/external-agent/workflow-preview/types'
import { Button } from '@langgenius/dify-ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { Separator } from '@langgenius/dify-ui/separator'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useAtomValue } from 'jotai'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { SearchInputClear } from '@/app/components/base/search-input'
import { useSearchInput } from '@/app/components/base/search-input/use-search-input'
import { editorAppIdAtom } from '@/app/components/workflow/editor-resource/state'
import { ExternalAgentOptions } from '@/features/agent-v2/external-agent/workflow-preview/agent-options'
import { CompactTagFilter } from '@/features/tag-management/tag-filter'
import Link from '@/next/link'
import { consoleQuery } from '@/service/console'

type AgentSource = 'all' | 'dify' | 'external'

type WorkflowAgentSelectorContentProps = {
  onSelect: (agent: AgentRosterNodeData) => void
  onSelectExternal?: (agent: ExternalAgentWorkflowPreviewAgent) => void | Promise<boolean>
  onStartFromScratch?: () => void
  onRequestClose: () => void
}

export function WorkflowAgentSelectorContent({
  onSelect,
  onSelectExternal,
  onStartFromScratch,
  onRequestClose,
}: WorkflowAgentSelectorContentProps) {
  const { t } = useTranslation(['agentRoster', 'workflow', 'common'])
  const appId = useAtomValue(editorAppIdAtom)
  const [source, setSource] = useState<AgentSource>('all')
  const [search, setSearch] = useState('')
  const { inputProps, canClear, clearProps } = useSearchInput({
    value: search,
    onValueChange: setSearch,
  })
  const keyword = useDebounce(search.trim(), { wait: 300 })
  const [tagIds, setTagIds] = useState<string[]>([])
  const tagPortalRef = useRef<HTMLDivElement>(null)
  const showExternal =
    Boolean(onSelectExternal) && (source === 'external' || (source === 'all' && !tagIds.length))
  const agentsQuery = useInfiniteQuery(
    consoleQuery.agent.inviteOptions.get.infiniteOptions({
      input: (page: number) => ({
        query: {
          limit: 8,
          page,
          ...(appId ? { app_id: appId } : {}),
          ...(keyword ? { keyword } : {}),
          ...(tagIds.length ? { tag_ids: tagIds } : {}),
        },
      }),
      initialPageParam: 1,
      getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
      enabled: source !== 'external',
      gcTime: 0,
      staleTime: 0,
    }),
  )
  const difyAgents =
    source === 'external' ? [] : (agentsQuery.data?.pages.flatMap((page) => page.data) ?? [])
  const isLoading = source !== 'external' && agentsQuery.isPending
  const hasDifyError = source !== 'external' && agentsQuery.isError
  const isEmpty = !isLoading && !hasDifyError && difyAgents.length === 0 && !showExternal
  const sources: AgentSource[] = onSelectExternal ? ['all', 'dify', 'external'] : ['all', 'dify']

  const selectDifyAgent = (agent: AgentInviteOptionResponse) => {
    if (!agent.active_config_snapshot_id) return
    onRequestClose()
    onSelect({
      description: agent.description,
      icon: agent.icon,
      icon_background: agent.icon_background,
      icon_type: agent.icon_type,
      id: agent.id,
      name: agent.name,
      role: agent.role,
    })
  }

  return (
    <>
      <div className="p-2">
        <InputGroup>
          <InputGroupInput
            {...inputProps}
            name="query"
            autoComplete="off"
            enterKeyHint="search"
            aria-label={t(($) => $['roster.searchLabel'])}
            placeholder={t(($) => $['roster.nodeSelector.searchPlaceholder'])}
          />
          <InputGroupAddon className="ps-1.75 pe-1.25">
            <span
              aria-hidden
              className="i-ri-search-line size-4 text-components-input-text-placeholder"
            />
          </InputGroupAddon>
          <InputGroupAddon align="inline-end" className="gap-1 ps-0.75 pe-0.5">
            {canClear && (
              <SearchInputClear
                {...clearProps}
                aria-label={t(($) => $['operation.clear'], { ns: 'common' })}
              />
            )}
            {source !== 'external' && (
              <>
                <Separator decorative orientation="vertical" className="h-3.5" />
                <CompactTagFilter
                  type="agent"
                  value={tagIds}
                  onChange={setTagIds}
                  container={tagPortalRef}
                />
              </>
            )}
          </InputGroupAddon>
        </InputGroup>
      </div>
      <Tabs
        value={source}
        onValueChange={(value) => {
          if (value === 'all' || value === 'dify' || value === 'external') setSource(value)
        }}
      >
        <TabsList
          aria-label={t(($) => $['roster.nodeSelector.dialogLabel'])}
          className="h-8 gap-0.5 border-b border-divider-subtle px-3"
        >
          {sources.map((tab) => (
            <TabsTab
              key={tab}
              value={tab}
              className="h-6 rounded-md border-0 px-2 py-1 system-xs-medium text-text-tertiary data-active:bg-state-base-hover-alt data-active:text-text-primary"
            >
              {t(($) => $[`roster.nodeSelector.tabs.${tab}`])}
            </TabsTab>
          ))}
        </TabsList>
        {sources.map((tab) => (
          <TabsPanel
            key={tab}
            value={tab}
            className="flex max-h-64 min-h-26 flex-col overflow-y-auto overscroll-contain p-1"
          >
            {source === tab && (
              <>
                {isLoading && <DifyAgentSelectorSkeleton />}
                {hasDifyError && (
                  <p role="status" className="px-3 py-2 system-sm-regular text-text-tertiary">
                    {t(($) => $['roster.loadingError'])}
                  </p>
                )}
                {!hasDifyError &&
                  difyAgents.map((agent) => (
                    <Button
                      key={agent.id}
                      variant="ghost"
                      disabled={!agent.active_config_snapshot_id}
                      focusableWhenDisabled
                      className="h-auto min-h-8 w-full shrink-0 justify-start gap-2 rounded-lg py-1.5 ps-3 pe-2"
                      onClick={() => selectDifyAgent(agent)}
                    >
                      <AppIcon size="small" icon={{ ...agent, icon_url: agent.icon }} />
                      <span className="flex min-w-0 flex-1 flex-col text-start">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate system-sm-medium text-text-secondary">
                            {agent.name}
                          </span>
                          {source === 'all' && (
                            <span className="shrink-0 system-xs-regular text-text-quaternary">
                              {t(($) => $['roster.nodeSelector.source.dify'])}
                            </span>
                          )}
                        </span>
                        {(agent.role || agent.description) && (
                          <span className="truncate system-xs-regular text-text-tertiary">
                            {agent.role || agent.description}
                          </span>
                        )}
                        {!agent.active_config_snapshot_id && (
                          <span className="system-xs-regular text-text-tertiary">
                            {t(($) => $['nodes.agent.modelNotSelected'], { ns: 'workflow' })}
                          </span>
                        )}
                      </span>
                    </Button>
                  ))}
                {source !== 'external' && agentsQuery.hasNextPage && (
                  <Button
                    variant="ghost"
                    disabled={agentsQuery.isFetching}
                    onClick={() => void agentsQuery.fetchNextPage()}
                  >
                    {agentsQuery.isFetchingNextPage
                      ? t(($) => $.loading, { ns: 'common' })
                      : t(($) => $['roster.loadMore'])}
                  </Button>
                )}
                {showExternal && onSelectExternal && (
                  <ExternalAgentOptions
                    keyword={keyword}
                    onSelect={async (agent) => {
                      const selected = await onSelectExternal(agent)
                      if (selected !== false) onRequestClose()
                    }}
                  />
                )}
                {isEmpty && (
                  <p role="status" className="px-3 py-2 system-sm-regular text-text-tertiary">
                    {search.trim() || tagIds.length
                      ? t(($) => $['roster.emptySearch'])
                      : t(($) => $['roster.empty'])}
                  </p>
                )}
              </>
            )}
          </TabsPanel>
        ))}
      </Tabs>
      {onStartFromScratch && source !== 'external' && !search.trim() && (
        <div className="border-t border-divider-subtle p-1">
          <Button
            variant="ghost"
            className="h-8 w-full justify-start gap-2 rounded-lg ps-3 pe-2 system-xs-medium text-text-secondary"
            onClick={() => {
              onRequestClose()
              onStartFromScratch()
            }}
          >
            <span aria-hidden className="i-ri-add-line size-4 shrink-0 text-text-tertiary" />
            {t(($) => $['roster.nodeSelector.startFromScratch'])}
          </Button>
        </div>
      )}
      <div className="flex h-8 items-center border-t border-divider-subtle px-4">
        <Link
          href="/agents"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 rounded-sm system-xs-medium text-text-tertiary hover:text-text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-accent-solid"
        >
          {t(($) => $['roster.nodeSelector.manageInAgentConsole'])}
          <span aria-hidden className="i-ri-arrow-right-up-line size-3" />
        </Link>
      </div>
      <div ref={tagPortalRef} />
    </>
  )
}

function DifyAgentSelectorSkeleton() {
  return (
    <div aria-hidden className="space-y-1 p-2">
      {[0, 1, 2].map((item) => (
        <div key={item} className="flex h-8 items-center gap-2 opacity-20">
          <span className="size-6 rounded-md bg-text-quaternary" />
          <span className="h-2 w-32 rounded-xs bg-text-quaternary" />
        </div>
      ))}
    </div>
  )
}
