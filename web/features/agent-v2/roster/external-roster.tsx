'use client'

import type { GetExternalAgentsData } from '@dify/contracts/api/console/external-agents/types.gen'
import type { ExternalAgentConfirmationRequest } from './components/external-agent-actions'
import type { ExternalAgentListItem } from './components/external-agent-list'
import { Alert, AlertTitle } from '@langgenius/dify-ui/alert'
import { AlertDialog, createAlertDialogHandle } from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { createDialogHandle, Dialog } from '@langgenius/dify-ui/dialog'
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
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useAtomValue } from 'jotai'
import { useQueryStates } from 'nuqs'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import { currentWorkspaceAtom, currentWorkspaceLoadingAtom } from '@/context/workspace-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { toExternalAgentListItem } from '@/features/agent-v2/external-agent/model'
import { TagFilter } from '@/features/tag-management/tag-filter'
import { TagManagementDialogContent } from '@/features/tag-management/tag-management-dialog'
import { consoleQuery } from '@/service/console'
import { AgentRosterSkeleton } from './components/agent-roster-skeleton'
import { ConnectExternalAgent } from './components/connect-external-agent'
import {
  ExternalAgentConfirmationContent,
  ExternalAgentEditDialogContent,
} from './components/external-agent-actions'
import { ExternalAgentList } from './components/external-agent-list'
import { externalRosterQueryParsers } from './query-params'

const EMPTY_STATUS_COUNTS = {
  enabled_count: 0,
  disabled_count: 0,
} as const

export function ExternalRoster() {
  const workspace = useAtomValue(currentWorkspaceAtom)
  return <ExternalRosterSession key={workspace.id} />
}

function ExternalRosterSession() {
  const { t } = useTranslation(['agentRoster'])
  const queryClient = useQueryClient()
  const workspace = useAtomValue(currentWorkspaceAtom)
  const workspaceLoading = useAtomValue(currentWorkspaceLoadingAtom)
  const profile = useQuery(userProfileQueryOptions())
  const canManage = !workspaceLoading && (workspace.role === 'owner' || workspace.role === 'admin')
  const canReadDetails = !workspaceLoading && (canManage || workspace.role === 'editor')
  const [editDialog] = useState(() => createDialogHandle<ExternalAgentListItem>())
  const [confirmation] = useState(() => createAlertDialogHandle<ExternalAgentConfirmationRequest>())
  const update = useMutation(
    consoleQuery.externalAgents.byAgentId.info.patch.mutationOptions({
      context: { silent: true },
      retry: false,
    }),
  )
  const toggle = useMutation(
    consoleQuery.externalAgents.byAgentId.enabled.put.mutationOptions({
      context: { silent: true },
      retry: false,
    }),
  )
  const deletion = useMutation(
    consoleQuery.externalAgents.byAgentId.delete.mutationOptions({
      context: { silent: true },
      retry: false,
    }),
  )
  const searchRef = useRef<HTMLInputElement>(null)
  const removalFocusRef = useRef<HTMLElement[] | null>(null)
  const allStatusRef = useRef<HTMLButtonElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [tagManagementDialog] = useState(() => createDialogHandle())
  const sortLabelId = useId()
  const [filters, setFilters] = useQueryStates(externalRosterQueryParsers)
  const urlTagIds = filters.external_tag_ids
  const tagCatalog = useQuery(
    consoleQuery.tags.get.queryOptions({
      input: { query: { type: 'agent' } },
      enabled: urlTagIds.length > 0,
      refetchOnMount: 'always',
    }),
  )
  const tagIds = useMemo(() => {
    if (!urlTagIds.length || !tagCatalog.isSuccess || tagCatalog.isFetching) return urlTagIds
    const availableIds = new Set(tagCatalog.data.map((tag) => tag.id))
    return urlTagIds.filter((id) => availableIds.has(id))
  }, [urlTagIds, tagCatalog.data, tagCatalog.isSuccess, tagCatalog.isFetching])
  useEffect(() => {
    if (tagIds.length === urlTagIds.length) return
    // oxlint-disable-next-line eslint-react/set-state-in-effect -- Reconcile the shareable filter with the authoritative catalog.
    void setFilters({ external_tag_ids: tagIds })
  }, [tagIds, urlTagIds, setFilters])
  const trimmedKeyword = filters.external_keyword.trim().slice(0, 255)
  const delayedKeyword = useDebounce(trimmedKeyword, { wait: 300 })
  const keyword = trimmedKeyword ? delayedKeyword : ''
  const capabilities = useQuery(consoleQuery.externalAgents.capabilities.get.queryOptions())
  const sortBy = filters.external_sort_by === 'last_modified' ? 'updated_at' : 'created_at'
  const sortOrder = filters.external_sort_by === 'earliest_created' ? 'asc' : 'desc'
  const firstUnfilteredPage = {
    page: 1,
    limit: 20,
    connected_by_me: false,
    sort_by: sortBy,
    sort_order: sortOrder,
  } satisfies NonNullable<GetExternalAgentsData['query']>
  const rosterQueryInput = (
    page: number,
    selectedTagIds: string[],
  ): Pick<GetExternalAgentsData, 'query'> => ({
    query: {
      ...firstUnfilteredPage,
      page,
      ...(keyword ? { keyword } : {}),
      ...(selectedTagIds.length ? { tag_ids: selectedTagIds } : {}),
      connected_by_me: filters.external_connected_by_me,
      ...(filters.external_status === 'all'
        ? {}
        : { enabled: filters.external_status === 'enabled' }),
    },
  })
  const resetRosterPagination = (input: ReturnType<typeof rosterQueryInput>) => {
    queryClient.removeQueries({
      queryKey: consoleQuery.externalAgents.get.key({ type: 'infinite', input }),
      exact: true,
      type: 'inactive',
    })
    viewportRef.current?.scrollTo({ top: 0 })
  }
  const list = useInfiniteQuery({
    ...consoleQuery.externalAgents.get.infiniteOptions({
      input: (page) => rosterQueryInput(Number(page), tagIds),
      initialPageParam: 1,
      getNextPageParam: (last) => (last.page * last.limit < last.total ? last.page + 1 : undefined),
      enabled: capabilities.isSuccess && !workspaceLoading,
    }),
    placeholderData: keepPreviousData,
  })
  const counts = list.data?.pages[0] ?? EMPTY_STATUS_COUNTS
  const agents =
    list.data?.pages.flatMap((page) =>
      page.items.map((asset) => toExternalAgentListItem(asset, profile.data?.profile.id)),
    ) ?? []
  const statusOptions = [
    { value: 'all', label: t(($) => $['roster.filters.all']) },
    {
      value: 'enabled',
      label: t(($) => $['external.filters.enabled']),
      count: counts.enabled_count,
    },
    {
      value: 'disabled',
      label: t(($) => $['external.filters.disabled']),
      count: counts.disabled_count,
    },
  ] as const
  const sortOptions = [
    { value: 'last_modified', label: t(($) => $['roster.sort.lastModified']) },
    { value: 'recently_created', label: t(($) => $['roster.sort.recentlyCreated']) },
    { value: 'earliest_created', label: t(($) => $['roster.sort.earliestCreated']) },
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
              ref={option.value === 'all' ? allStatusRef : undefined}
              value={option.value}
              className="gap-1 data-checked:text-text-secondary"
            >
              <span>{option.label}</span>
              {'count' in option && (
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
        <TagFilter
          type="agent"
          value={tagIds}
          onChange={(nextIds) => {
            resetRosterPagination(rosterQueryInput(1, nextIds))
            void setFilters({ external_tag_ids: nextIds })
          }}
          onOpenTagManagement={() => tagManagementDialog.open(null)}
        />
        <div className="ms-auto flex flex-wrap items-center justify-end gap-2">
          <Select
            items={sortOptions}
            value={filters.external_sort_by}
            onValueChange={(value) => {
              if (value !== null) void setFilters({ external_sort_by: value })
            }}
          >
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
              {sortOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <SelectItemText>{option.label}</SelectItemText>
                  <SelectItemIndicator />
                </SelectItem>
              ))}
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
          <AgentRosterSkeleton className="px-2 pt-2 sm:px-8" />
        ) : (
          <div className="min-h-0 flex-1">
            <ExternalAgentList
              agents={agents}
              canReadDetails={canReadDetails}
              viewportRef={viewportRef}
              onOpenTagManagement={() => tagManagementDialog.open(null)}
              editDialog={canManage ? editDialog : undefined}
              confirmation={canManage ? confirmation : undefined}
              onClearFilters={() => {
                resetRosterPagination({ query: firstUnfilteredPage })
                void setFilters({
                  external_keyword: '',
                  external_tag_ids: [],
                  external_status: 'all',
                  external_connected_by_me: false,
                })
                allStatusRef.current?.focus()
              }}
              filtered={Boolean(
                keyword ||
                tagIds.length ||
                filters.external_status !== 'all' ||
                filters.external_connected_by_me,
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
      <Dialog
        handle={editDialog}
        disablePointerDismissal
        onOpenChange={(open, details) => {
          if (!open && update.isPending && details.reason !== 'imperative-action') details.cancel()
        }}
        onOpenChangeComplete={(open) => {
          if (!open) update.reset()
        }}
      >
        {({ payload }) =>
          payload && (
            <ExternalAgentEditDialogContent
              agent={payload}
              pending={update.isPending}
              error={update.error}
              onReset={update.reset}
              onSubmit={(input) => update.mutate(input, { onSuccess: () => editDialog.close() })}
            />
          )
        }
      </Dialog>
      <AlertDialog
        handle={confirmation}
        onOpenChange={(open, details) => {
          if (
            !open &&
            (toggle.isPending || deletion.isPending) &&
            details.reason !== 'imperative-action'
          )
            details.cancel()
        }}
        onOpenChangeComplete={(open) => {
          if (!open) {
            toggle.reset()
            deletion.reset()
            if (removalFocusRef.current) {
              const target =
                removalFocusRef.current.find((element) => element.isConnected) ?? searchRef.current
              removalFocusRef.current = null
              requestAnimationFrame(() => target?.focus({ preventScroll: true }))
            }
          }
        }}
      >
        {({ payload }) =>
          payload && (
            <ExternalAgentConfirmationContent
              request={payload}
              pending={toggle.isPending || deletion.isPending}
              error={payload.kind === 'delete' ? deletion.error : toggle.error}
              fallbackFocus={searchRef}
              onPauseInstead={() => confirmation.openWithPayload({ ...payload, kind: 'toggle' })}
              onConfirm={() => {
                if (payload.kind === 'delete')
                  deletion.mutate(
                    { params: { agent_id: payload.agent.key } },
                    {
                      onSuccess: () => {
                        removalFocusRef.current = payload.adjacentFocusTargets
                        confirmation.close()
                      },
                    },
                  )
                else
                  toggle.mutate(
                    {
                      params: { agent_id: payload.agent.key },
                      body: { enabled: !payload.agent.enabled },
                    },
                    { onSuccess: () => confirmation.close() },
                  )
              }}
            />
          )
        }
      </AlertDialog>
      <Dialog handle={tagManagementDialog}>
        <TagManagementDialogContent type="agent" />
      </Dialog>
    </>
  )
}
