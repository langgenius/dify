import type { ExternalAgentAssetResponse } from '@dify/contracts/api/console/external-agents/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { currentWorkspaceAtom, currentWorkspaceLoadingAtom } from '@/context/workspace-state'
import { consoleQuery } from '@/service/console'
import { toExternalAgentListItem } from '../model'

export function ExternalAgentOptions({
  keyword,
  allowDisabled = false,
  onSelect,
}: {
  keyword: string
  allowDisabled?: boolean
  onSelect: (agent: ExternalAgentAssetResponse) => void
}) {
  const { t } = useTranslation(['agentRoster'])
  const workspace = useAtomValue(currentWorkspaceAtom)
  const workspaceLoading = useAtomValue(currentWorkspaceLoadingAtom)
  const canBind = !workspaceLoading && ['owner', 'admin', 'editor'].includes(workspace.role)
  const capabilities = useQuery(consoleQuery.externalAgents.capabilities.get.queryOptions())
  const agents = useInfiniteQuery(
    consoleQuery.externalAgents.get.infiniteOptions({
      input: (page) => ({ query: { page, limit: 20, ...(keyword ? { keyword } : {}) } }),
      initialPageParam: 1,
      getNextPageParam: (page) => (page.page * page.limit < page.total ? page.page + 1 : undefined),
    }),
  )
  if (agents.isPending || capabilities.isPending || workspaceLoading)
    return (
      <div aria-hidden className="space-y-1 p-2">
        {[0, 1, 2].map((key) => (
          <div key={key} className="h-8 rounded-md bg-state-base-hover-alt" />
        ))}
      </div>
    )
  if (agents.isError || capabilities.isError)
    return (
      <p role="status" className="p-3 system-xs-regular text-text-tertiary">
        {t(($) => $['roster.loadingError'])}
      </p>
    )

  const items = agents.data.pages.flatMap((page) => page.items)
  return (
    <>
      {!capabilities.data.enabled && (
        <p role="status" className="p-3 system-xs-regular text-text-tertiary">
          {t(($) => $['external.workflow.unavailable'])}
        </p>
      )}
      {items.map((asset) => {
        const agent = toExternalAgentListItem(asset)
        return (
          <Button
            key={asset.id}
            variant="ghost"
            disabled={
              !canBind || (!allowDisabled && (!capabilities.data.enabled || !asset.enabled))
            }
            className="h-8 w-full shrink-0 justify-start gap-2 rounded-lg ps-3 pe-2 disabled:opacity-50"
            onClick={() => onSelect(asset)}
          >
            <AppIcon
              size="tiny"
              icon={agent.icon}
              fallback={{
                content: (
                  <span aria-hidden className="i-ri-robot-2-line size-3.5 text-text-accent" />
                ),
                background: 'var(--color-components-icon-bg-indigo-soft)',
              }}
            />
            <span className="truncate system-sm-medium text-text-secondary">{agent.name}</span>
            <span className="shrink-0 system-xs-regular text-text-quaternary">
              {asset.enabled
                ? t(($) => $['roster.nodeSelector.source.external'])
                : t(($) => $['external.filters.disabled'])}
            </span>
          </Button>
        )
      })}
      {items.length === 0 && (
        <p role="status" className="p-3 system-xs-regular text-text-tertiary">
          {keyword ? t(($) => $['roster.emptySearch']) : t(($) => $['roster.empty'])}
        </p>
      )}
      {agents.hasNextPage && (
        <Button
          variant="ghost"
          disabled={agents.isFetchingNextPage}
          onClick={() => agents.fetchNextPage()}
        >
          {t(($) => $['external.workflow.loadMore'])}
        </Button>
      )}
      {agents.isFetchNextPageError && (
        <p role="status" className="p-3 system-xs-regular text-text-tertiary">
          {t(($) => $['roster.loadingError'])}
        </p>
      )}
    </>
  )
}
