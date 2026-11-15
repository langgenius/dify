'use client'

import type { ExternalAgentActionRequest } from './components/external-agent-actions'
import { Alert, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useAtomValue } from 'jotai'
import { useQueryStates } from 'nuqs'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { currentWorkspaceAtom, currentWorkspaceLoadingAtom } from '@/context/workspace-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { toExternalAgentListItem } from '@/features/agent-v2/external-agent/model'
import { consoleQuery } from '@/service/console'
import { ConnectExternalAgent } from './components/connect-external-agent'
import { ExternalAgentActions } from './components/external-agent-actions'
import { ExternalAgentList } from './components/external-agent-list'
import { externalRosterQueryParsers } from './query-params'

export function ExternalRoster() {
  const { t } = useTranslation(['agentRoster', 'common'])
  const workspace = useAtomValue(currentWorkspaceAtom)
  const workspaceLoading = useAtomValue(currentWorkspaceLoadingAtom)
  const profile = useQuery(userProfileQueryOptions())
  const canManage = !workspaceLoading && (workspace.role === 'owner' || workspace.role === 'admin')
  const canReadDetails = !workspaceLoading && (canManage || workspace.role === 'editor')
  const [actionRequest, setActionRequest] = useState<ExternalAgentActionRequest>()
  const [actionOpen, setActionOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const sortLabelId = useId()
  const [filters, setFilters] = useQueryStates(externalRosterQueryParsers)
  const keyword = useDebounce(filters.external_keyword.trim().slice(0, 255), { wait: 300 })
  const capabilities = useQuery(consoleQuery.externalAgents.capabilities.get.queryOptions())
  const commonFilters = {
    ...(keyword ? { keyword } : {}),
    connected_by_me: filters.external_connected_by_me,
  }
  const list = useInfiniteQuery(
    consoleQuery.externalAgents.get.infiniteOptions({
      input: (page) => ({
        query: {
          ...commonFilters,
          page: Number(page),
          limit: 20,
          ...(filters.external_status === 'all'
            ? {}
            : { enabled: filters.external_status === 'enabled' }),
        },
      }),
      initialPageParam: 1,
      getNextPageParam: (last) => (last.page * last.limit < last.total ? last.page + 1 : undefined),
      enabled: capabilities.isSuccess && !workspaceLoading,
    }),
  )
  const enabledCount = useQuery(
    consoleQuery.externalAgents.get.queryOptions({
      input: { query: { ...commonFilters, page: 1, limit: 1, enabled: true } },
      select: (data) => data.total,
      enabled: capabilities.isSuccess && !workspaceLoading,
    }),
  )
  const disabledCount = useQuery(
    consoleQuery.externalAgents.get.queryOptions({
      input: { query: { ...commonFilters, page: 1, limit: 1, enabled: false } },
      select: (data) => data.total,
      enabled: capabilities.isSuccess && !workspaceLoading,
    }),
  )
  const agents =
    list.data?.pages.flatMap((page) =>
      page.items.map((asset) => toExternalAgentListItem(asset, profile.data?.profile.id)),
    ) ?? []
  const statusOptions = [
    { value: 'all', label: t(($) => $['roster.filters.all']) },
    { value: 'enabled', label: t(($) => $['external.filters.enabled']), count: enabledCount.data },
    {
      value: 'disabled',
      label: t(($) => $['external.filters.disabled']),
      count: disabledCount.data,
    },
  ] as const
  const sortOptions = [
    { value: 'last_modified', label: t(($) => $['roster.sort.lastModified']) },
  ] as const
  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-2 pt-3.5 pb-2 sm:px-8">
        <SegmentedControl
          aria-label={t(($) => $['external.filters.label'])}
          value={filters.external_status}
          onValueChange={(value) => void setFilters({ external_status: value })}
          className="shrink-0"
        >
          {statusOptions.map((option) => (
            <SegmentedControlItem
              key={option.value}
              value={option.value}
              className="gap-1 data-checked:text-text-secondary"
            >
              <span>{option.label}</span>
              {'count' in option && option.count !== undefined && (
                <span className="flex min-w-4 shrink-0 items-center justify-center rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary tabular-nums">
                  {option.count}
                </span>
              )}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        <SearchInput
          ref={searchRef}
          aria-label={t(($) => $['roster.searchLabel'])}
          placeholder={t(($) => $['external.searchPlaceholder'])}
          value={filters.external_keyword}
          onValueChange={(value) => void setFilters({ external_keyword: value })}
          className="h-8 w-full min-w-0 sm:w-50"
        />
        <div aria-hidden className="hidden h-4 shrink-0 px-1 sm:flex">
          <div className="h-full w-px bg-divider-regular" />
        </div>
        <label className="flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-lg bg-components-input-bg-normal px-2 py-1 whitespace-nowrap">
          <Checkbox
            checked={filters.external_connected_by_me}
            onCheckedChange={(checked) =>
              void setFilters({ external_connected_by_me: checked === true })
            }
          />
          <span className="p-1 system-sm-regular text-text-tertiary">
            {t(($) => $['external.filters.connectedByMe'])}
          </span>
        </label>
        <div className="ms-auto flex flex-wrap items-center justify-end gap-2">
          <Select disabled items={sortOptions} value="last_modified">
            <SelectTrigger aria-labelledby={sortLabelId} className="w-auto max-w-45 min-w-0">
              <span className="flex min-w-0 items-center gap-1 whitespace-nowrap">
                <span
                  id={sortLabelId}
                  aria-hidden
                  className="shrink-0 font-normal text-text-tertiary"
                >
                  {t(($) => $['roster.sort.label'])}
                </span>
                <SelectValue className="min-w-0 truncate font-medium text-text-secondary" />
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="last_modified">
                <SelectItemText>{sortOptions[0].label}</SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
            </SelectContent>
          </Select>
          {canManage && <ConnectExternalAgent key={workspace.id} />}
        </div>
      </div>
      {capabilities.data?.enabled === false && (
        <div className="px-2 pb-2 sm:px-8">
          <Alert type="warning">
            <AlertTitle>{t(($) => $['external.api.executionDisabled'])}</AlertTitle>
          </Alert>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col max-md:min-h-64">
        {capabilities.isError || list.isLoadingError ? null : capabilities.isPending ||
          list.isPending ? (
          <div
            role="status"
            className="grid gap-2.5 px-2 pt-2 sm:grid-cols-2 sm:px-8 lg:grid-cols-4"
          >
            <span className="sr-only">{t(($) => $.loading, { ns: 'common' })}</span>
            {[0, 1, 2, 3].map((item) => (
              <SkeletonRectangle key={item} className="h-36.5 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="min-h-0 flex-1">
            <ExternalAgentList
              agents={agents}
              canReadDetails={canReadDetails}
              onAction={
                canManage
                  ? (request) => {
                      setActionRequest(request)
                      setActionOpen(true)
                    }
                  : undefined
              }
              onClearFilters={() => {
                void setFilters({
                  external_keyword: '',
                  external_status: 'all',
                  external_connected_by_me: false,
                })
                searchRef.current?.focus()
              }}
              filtered={Boolean(
                keyword || filters.external_status !== 'all' || filters.external_connected_by_me,
              )}
            />
          </div>
        )}
        {list.hasNextPage && (
          <div className="flex shrink-0 justify-center py-2">
            <Button
              variant="secondary"
              loading={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {t(($) => $['roster.loadMore'])}
            </Button>
          </div>
        )}
      </div>
      <ExternalAgentActions
        key={workspace.id}
        request={actionRequest}
        open={actionOpen}
        onOpenChange={setActionOpen}
        onRequest={(request) => {
          setActionRequest(request)
          setActionOpen(true)
        }}
        fallbackFocus={searchRef}
      />
    </>
  )
}
