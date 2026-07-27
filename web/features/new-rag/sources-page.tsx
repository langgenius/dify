'use client'

import type { Source } from '@dify/contracts/knowledge-fs/types.gen'
import type { StatusDotStatus } from '@langgenius/dify-ui/status-dot'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { toast } from '@langgenius/dify-ui/toast'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import Link from '@/next/link'
import { consoleClient, consoleQuery } from '@/service/client'
import { hasPermission } from '@/utils/permission'
import { newKnowledgeAddSourcePath } from './routes'

type SourceStatus = Source['status']
type SourceFilter = SourceStatus | 'all'
type SourceSort = 'name-asc' | 'name-desc'

const PAGE_SIZE = 50
const MAX_AUTO_FILTER_PAGES = 4
const SOURCE_POLL_INTERVAL = 3000

const statusDotStatus: Record<SourceStatus, StatusDotStatus> = {
  active: 'success',
  syncing: 'normal',
  disabled: 'disabled',
  error: 'error',
}

function metadataString(metadata: Source['metadata'], key: string) {
  const value = metadata[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function isPreviewDraft(source: Source) {
  return source.metadata.preview === true && source.status === 'disabled'
}

function createIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

function getOpenableSourceUri(uri: string) {
  try {
    const url = new URL(uri)
    return url.protocol === 'http:' || url.protocol === 'https:' ? uri : undefined
  } catch {
    return undefined
  }
}

function getCurrentSource(source: Source, sourceOverride?: Source) {
  if (!sourceOverride || sourceOverride.id !== source.id) return source
  const sourceVersion = source.version ?? -1
  const overrideVersion = sourceOverride.version ?? -1
  if (sourceVersion > overrideVersion) return source
  if (sourceVersion < overrideVersion) return sourceOverride
  return source.updatedAt > sourceOverride.updatedAt ? source : sourceOverride
}

type SourceAction = 'remove' | 'sync' | 'toggle'

function SourceActions({
  canEdit,
  canSync,
  onRemove,
  onSync,
  onToggle,
  pendingAction,
  source,
}: {
  canEdit: boolean
  canSync: boolean
  onRemove: () => Promise<boolean>
  onSync: () => Promise<boolean>
  onToggle: () => Promise<boolean>
  pendingAction?: SourceAction
  source: Source
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
  const sourceUri = getOpenableSourceUri(source.uri)

  if (!canEdit && !canSync && !sourceUri) return null

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          aria-label={t(($) => $['newKnowledge.sourceActions'], { name: source.name })}
          disabled={Boolean(pendingAction)}
          className="flex size-7 items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:text-text-disabled"
        >
          <span
            aria-hidden
            className={cn(
              'size-4',
              pendingAction ? 'i-ri-loader-4-line animate-spin' : 'i-ri-more-fill',
            )}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-48">
          {canSync && (
            <DropdownMenuItem onClick={() => void onSync()} className="gap-2 px-3">
              <span aria-hidden className="i-ri-refresh-line size-4" />
              {t(($) => $['newKnowledge.syncNow'])}
            </DropdownMenuItem>
          )}
          {sourceUri && (
            <DropdownMenuLinkItem
              render={
                <a
                  aria-label={tCommon(($) => $['operation.openInNewTab'])}
                  href={sourceUri}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
              className="gap-2 px-3"
            >
              <span aria-hidden className="i-ri-external-link-line size-4" />
              {tCommon(($) => $['operation.openInNewTab'])}
            </DropdownMenuLinkItem>
          )}
          {canEdit && (
            <>
              <DropdownMenuItem onClick={() => void onToggle()} className="gap-2 px-3">
                <span
                  aria-hidden
                  className={cn(
                    'size-4',
                    source.status === 'disabled'
                      ? 'i-ri-checkbox-circle-line'
                      : 'i-ri-indeterminate-circle-line',
                  )}
                />
                {source.status === 'disabled'
                  ? t(($) => $.enable)
                  : t(($) => $['newKnowledge.disableSource'])}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setRemoveDialogOpen(true)}
                variant="destructive"
                className="gap-2 px-3"
              >
                <span aria-hidden className="i-ri-delete-bin-line size-4" />
                {t(($) => $['newKnowledge.removeSource'])}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
              {tCommon(($) => $['operation.deleteConfirmTitle'])}
            </AlertDialogTitle>
            <AlertDialogDescription className="system-sm-regular text-text-tertiary">
              {tCommon(($) => $['operation.confirmAction'])}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton variant="secondary">
              {tCommon(($) => $['operation.cancel'])}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              tone="destructive"
              loading={pendingAction === 'remove'}
              disabled={pendingAction === 'remove'}
              onClick={() =>
                void onRemove().then((removed) => {
                  if (removed) setRemoveDialogOpen(false)
                })
              }
            >
              {t(($) => $['newKnowledge.removeSource'])}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function SourceRow({
  canEdit,
  canSync,
  checked,
  knowledgeSpaceId,
  onCheckedChange,
  onRemoved,
  onSourceChange,
  source,
}: {
  canEdit: boolean
  canSync: boolean
  checked: boolean
  knowledgeSpaceId: string
  onCheckedChange: (checked: boolean) => void
  onRemoved: () => void
  onSourceChange: (source: Source) => void
  source: Source
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const [pendingAction, setPendingAction] = useState<SourceAction>()
  const providerName = metadataString(source.metadata, 'providerName')
  const syncPolicy = metadataString(source.metadata, 'syncPolicy')
  const lastSync = metadataString(source.metadata, 'lastSyncedAt')
  const typeLabel = t(($) => $[`newKnowledge.sourceType.${source.type}`])

  const runAction = async <Result,>(
    action: SourceAction,
    mutation: () => Promise<Result>,
    onAccepted?: (result: Result) => void,
  ) => {
    if (pendingAction) return false
    setPendingAction(action)
    try {
      let result: Result
      try {
        result = await mutation()
      } catch {
        toast.error(t(($) => $['newKnowledge.sourcesErrorDescription']))
        try {
          await queryClient.invalidateQueries({
            queryKey: consoleQuery.knowledgeFs.getKnowledgeSpacesByIdSources.key(),
          })
        } catch {
          return false
        }
        return false
      }
      onAccepted?.(result)

      try {
        await queryClient.invalidateQueries({
          queryKey: consoleQuery.knowledgeFs.getKnowledgeSpacesByIdSources.key(),
        })
      } catch {
        // The accepted mutation is already reflected by the list-owner state.
      }
      return true
    } finally {
      setPendingAction(undefined)
    }
  }

  const syncSource = () =>
    runAction(
      'sync',
      () =>
        consoleClient.knowledgeFs.postKnowledgeSpacesByIdSourcesBySourceIdSync({
          headers: { 'Idempotency-Key': createIdempotencyKey() },
          params: { id: knowledgeSpaceId, sourceId: source.id },
        }),
      () => onSourceChange({ ...source, status: 'syncing' }),
    )

  const toggleSource = () =>
    runAction(
      'toggle',
      () =>
        consoleClient.knowledgeFs.patchKnowledgeSpacesByIdSourcesBySourceId({
          body: {
            ...(source.version === undefined ? {} : { expectedVersion: source.version }),
            status: source.status === 'disabled' ? 'active' : 'disabled',
          },
          params: { id: knowledgeSpaceId, sourceId: source.id },
        }),
      onSourceChange,
    )

  const removeSource = () =>
    runAction(
      'remove',
      async () => {
        if (source.version === undefined) throw new Error('Source version is required')
        return consoleClient.knowledgeFs.deleteKnowledgeSpacesByIdSourcesBySourceId({
          body: { expectedRevision: source.version },
          headers: { 'idempotency-key': createIdempotencyKey() },
          params: { id: knowledgeSpaceId, sourceId: source.id },
          query: { documents: 'keep' },
        })
      },
      onRemoved,
    )

  return (
    <tr
      className={cn('border-t border-divider-subtle', source.status === 'disabled' && 'opacity-60')}
    >
      <td className="w-7 py-2 pr-3">
        <Checkbox aria-label={source.name} checked={checked} onCheckedChange={onCheckedChange} />
      </td>
      <td className="min-w-0 py-2 pr-3 sm:min-w-64">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className={cn(
              'size-[18px] shrink-0 text-text-tertiary',
              source.type === 'web' ? 'i-ri-global-line' : 'i-ri-links-line',
            )}
          />
          <div className="min-w-0">
            <p className="truncate system-xs-medium text-text-primary">{source.name}</p>
          </div>
        </div>
      </td>
      <td className="hidden w-44 py-2 pr-3 sm:table-cell">
        <p className="system-xs-regular text-text-secondary">{providerName ?? typeLabel}</p>
        {providerName && <p className="system-2xs-regular text-text-tertiary">{typeLabel}</p>}
      </td>
      <td className="w-24 py-2 pr-3 sm:w-32">
        <span className="inline-flex items-center gap-1.5 system-xs-medium text-text-secondary">
          <StatusDot
            status={statusDotStatus[source.status]}
            className={cn(
              'shrink-0',
              source.status === 'syncing' && 'animate-pulse motion-reduce:animate-none',
            )}
          />
          {t(($) => $[`newKnowledge.sourceStatus.${source.status}`])}
        </span>
      </td>
      <td className="hidden w-32 py-2 pr-3 system-xs-regular text-text-secondary lg:table-cell">
        {syncPolicy ?? '—'}
      </td>
      <td
        className={cn(
          'hidden w-40 py-2 pr-3 system-xs-regular lg:table-cell',
          source.status === 'error' ? 'text-text-destructive' : 'text-text-secondary',
        )}
      >
        {source.status === 'error' ? (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="i-ri-error-warning-fill size-3.5" />
            {t(($) => $['newKnowledge.sourceSyncFailed'])}
          </span>
        ) : (
          (lastSync ?? '—')
        )}
      </td>
      <td className="w-20 py-2 text-right">
        <div className="flex items-center justify-end gap-1">
          {canSync && source.status === 'error' && (
            <Button
              size="small"
              variant="secondary"
              loading={pendingAction === 'sync'}
              disabled={Boolean(pendingAction)}
              onClick={() => void syncSource()}
            >
              {tCommon(($) => $['operation.retry'])}
            </Button>
          )}
          <SourceActions
            canEdit={canEdit}
            canSync={canSync}
            source={source}
            pendingAction={pendingAction}
            onSync={syncSource}
            onToggle={toggleSource}
            onRemove={removeSource}
          />
        </div>
      </td>
    </tr>
  )
}

function SourcesEmpty({
  canAddSource,
  knowledgeSpaceId,
}: {
  canAddSource: boolean
  knowledgeSpaceId: string
}) {
  const { t } = useTranslation('dataset')

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <div aria-hidden className="flex items-center gap-3">
        <span data-brand="firecrawl" className="i-custom-public-common-firecrawl size-5" />
        <span data-brand="jina" className="i-custom-public-llm-jina size-5" />
        <span
          data-brand="notion"
          className="i-custom-public-common-notion size-5 text-text-primary"
        />
        <span data-brand="google-drive" className="i-custom-public-common-google-drive size-5" />
        <span data-brand="confluence" className="i-custom-public-common-confluence size-5" />
        <span data-brand="dropbox" className="i-custom-public-common-dropbox size-5" />
      </div>
      <h2 className="mt-5 title-xl-semi-bold text-text-primary">
        {t(($) => $['newKnowledge.sourcesEmptyTitle'])}
      </h2>
      <p className="mt-2 max-w-md body-sm-regular text-text-tertiary">
        {t(($) => $['newKnowledge.sourcesEmptyDescription'])}
      </p>
      {canAddSource && (
        <Link
          href={newKnowledgeAddSourcePath(knowledgeSpaceId)}
          className="mt-5 inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-components-button-primary-bg px-3.5 system-sm-medium text-components-button-primary-text shadow-sm outline-hidden hover:bg-components-button-primary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        >
          <span aria-hidden className="i-ri-add-line size-4" />
          {t(($) => $['newKnowledge.addSource'])}
        </Link>
      )}
    </div>
  )
}

export function SourcesPage({ knowledgeSpaceId }: { knowledgeSpaceId: string }) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canManageSources = hasPermission(workspacePermissionKeys, 'dataset.external.connect')
  const [filter, setFilter] = useState<SourceFilter>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SourceSort>()
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(() => new Set())
  const [sourceOverrides, setSourceOverrides] = useState<Record<string, Source>>({})
  const [removedSourceIds, setRemovedSourceIds] = useState<Set<string>>(() => new Set())
  const sourcesQuery = useInfiniteQuery(
    consoleQuery.knowledgeFs.getKnowledgeSpacesByIdSources.infiniteOptions({
      input: (pageParam) => ({
        params: { id: knowledgeSpaceId },
        query: {
          limit: PAGE_SIZE,
          ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
        },
      }),
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      initialPageParam: null as string | null,
      refetchInterval: (query) =>
        query.state.data?.pages.some((page) =>
          page.items.some(
            (source) =>
              !removedSourceIds.has(source.id) &&
              getCurrentSource(source, sourceOverrides[source.id]).status === 'syncing',
          ),
        )
          ? SOURCE_POLL_INTERVAL
          : false,
    }),
  )
  const remoteSources = sourcesQuery.data?.pages.flatMap((page) => page.items)
  const sources = useMemo(
    () =>
      (remoteSources ?? [])
        .filter((source) => !removedSourceIds.has(source.id))
        .map((source) => getCurrentSource(source, sourceOverrides[source.id]))
        .filter((source) => !isPreviewDraft(source))
        .sort(
          (left, right) =>
            right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
        ),
    [remoteSources, removedSourceIds, sourceOverrides],
  )
  const loadedPageCount = sourcesQuery.data?.pages.length ?? 0
  const filteredSources = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase()
    const nextSources = (sources ?? []).filter((source) => {
      if (filter !== 'all' && source.status !== filter) return false
      if (!normalizedSearch) return true
      return `${source.name} ${source.uri}`.toLocaleLowerCase().includes(normalizedSearch)
    })
    if (!sort) return nextSources
    return [...nextSources].sort((left, right) => {
      const result = left.name.localeCompare(right.name)
      return sort === 'name-asc' ? result : -result
    })
  }, [filter, search, sort, sources])
  const localTransformActive = filter !== 'all' || Boolean(search.trim()) || Boolean(sort)
  const canAutoCompleteFilteredResults =
    localTransformActive && loadedPageCount < MAX_AUTO_FILTER_PAGES
  const latestSourcePage = sourcesQuery.data?.pages.at(-1)
  const needsVisibleSource =
    latestSourcePage !== undefined &&
    latestSourcePage.items.some((source) =>
      isPreviewDraft(getCurrentSource(source, sourceOverrides[source.id])),
    ) &&
    !latestSourcePage.items.some((source) => {
      if (removedSourceIds.has(source.id)) return false
      return !isPreviewDraft(getCurrentSource(source, sourceOverrides[source.id]))
    })
  const completingFilteredResults =
    (canAutoCompleteFilteredResults || needsVisibleSource) &&
    !sourcesQuery.isFetchNextPageError &&
    (sourcesQuery.hasNextPage || sourcesQuery.isFetchingNextPage)
  const allFilteredSourcesSelected =
    filteredSources.length > 0 &&
    filteredSources.every((source) => selectedSourceIds.has(source.id))
  const someFilteredSourcesSelected = filteredSources.some((source) =>
    selectedSourceIds.has(source.id),
  )
  const {
    fetchNextPage: fetchNextSourcePage,
    hasNextPage: hasNextSourcePage,
    isFetchingNextPage: isFetchingNextSourcePage,
  } = sourcesQuery

  useEffect(() => {
    if (
      (canAutoCompleteFilteredResults || needsVisibleSource) &&
      hasNextSourcePage &&
      !isFetchingNextSourcePage &&
      !sourcesQuery.isFetchNextPageError
    )
      void fetchNextSourcePage()
  }, [
    canAutoCompleteFilteredResults,
    fetchNextSourcePage,
    hasNextSourcePage,
    isFetchingNextSourcePage,
    needsVisibleSource,
    sourcesQuery.isFetchNextPageError,
  ])

  return (
    <main className="flex min-h-full flex-col px-4 py-6 sm:px-8 sm:py-7">
      <header>
        <div>
          <h2 className="title-xl-semi-bold text-text-primary">
            {t(($) => $['newKnowledge.sources'])}
          </h2>
          <p className="mt-1 system-xs-regular text-text-tertiary">
            {t(($) => $['newKnowledge.sourcesDescription'])}
          </p>
        </div>
      </header>
      {sourcesQuery.isPending ? (
        <div className="flex min-h-64 flex-1 items-center justify-center">
          <Loading />
        </div>
      ) : sourcesQuery.error && !sourcesQuery.data ? (
        <div className="flex min-h-64 flex-1 flex-col items-center justify-center px-6 text-center">
          <span aria-hidden className="i-ri-error-warning-line size-7 text-text-tertiary" />
          <h2 className="mt-3 title-xl-semi-bold text-text-primary">
            {t(($) => $['newKnowledge.sourcesErrorTitle'])}
          </h2>
          <p className="mt-2 body-sm-regular text-text-tertiary">
            {t(($) => $['newKnowledge.sourcesErrorDescription'])}
          </p>
          <Button className="mt-4" onClick={() => void sourcesQuery.refetch()}>
            {tCommon(($) => $['operation.retry'])}
          </Button>
        </div>
      ) : !sources?.length && !sourcesQuery.hasNextPage ? (
        <SourcesEmpty canAddSource={canManageSources} knowledgeSpaceId={knowledgeSpaceId} />
      ) : (
        <>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <label className="sr-only" htmlFor="source-filter">
              {t(($) => $['newKnowledge.sourceFilterLabel'])}
            </label>
            <select
              id="source-filter"
              value={filter}
              onChange={(event) => setFilter(event.target.value as SourceFilter)}
              className="h-8 rounded-lg border-0 bg-components-input-bg-normal px-3 system-xs-regular text-text-secondary outline-hidden focus:ring-2 focus:ring-state-accent-solid"
            >
              <option value="all">{t(($) => $['newKnowledge.allSources'])}</option>
              {(['active', 'syncing', 'disabled', 'error'] as const).map((status) => (
                <option key={status} value={status}>
                  {t(($) => $[`newKnowledge.sourceStatus.${status}`])}
                </option>
              ))}
            </select>
            <label className="relative sm:w-64">
              <span className="sr-only">{t(($) => $['newKnowledge.searchSources'])}</span>
              <span
                aria-hidden
                className="pointer-events-none absolute top-2 left-2.5 i-ri-search-line size-4 text-text-quaternary"
              />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t(($) => $['newKnowledge.searchSources'])}
                className="h-8 w-full rounded-lg border-0 bg-components-input-bg-normal pr-3 pl-8 system-xs-regular text-text-primary outline-hidden placeholder:text-text-quaternary focus:ring-2 focus:ring-state-accent-solid"
              />
            </label>
            {canManageSources && (
              <Link
                href={newKnowledgeAddSourcePath(knowledgeSpaceId)}
                className="inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-components-button-primary-bg px-3.5 system-sm-medium text-components-button-primary-text shadow-sm outline-hidden hover:bg-components-button-primary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid sm:ml-auto"
              >
                <span aria-hidden className="i-ri-add-line size-4" />
                {t(($) => $['newKnowledge.addSource'])}
              </Link>
            )}
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full table-fixed border-collapse text-left lg:min-w-[900px] lg:table-auto">
              <thead className="system-2xs-medium text-text-tertiary uppercase">
                <tr>
                  <th className="w-7 pr-3 pb-2">
                    <Checkbox
                      aria-label={tCommon(($) => $['operation.selectAll'])}
                      checked={allFilteredSourcesSelected}
                      indeterminate={someFilteredSourcesSelected && !allFilteredSourcesSelected}
                      onCheckedChange={(checked) => {
                        setSelectedSourceIds((current) => {
                          const next = new Set(current)
                          for (const source of filteredSources) {
                            if (checked) next.add(source.id)
                            else next.delete(source.id)
                          }
                          return next
                        })
                      }}
                    />
                  </th>
                  <th
                    aria-sort={
                      sort === 'name-asc'
                        ? 'ascending'
                        : sort === 'name-desc'
                          ? 'descending'
                          : 'none'
                    }
                    className="pb-2 font-medium"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setSort((current) => (current === 'name-asc' ? 'name-desc' : 'name-asc'))
                      }
                      className="inline-flex items-center gap-1 rounded outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                    >
                      {t(($) => $['newKnowledge.sourceColumn'])}
                      <span
                        aria-hidden
                        className={cn(
                          'size-3.5',
                          sort === 'name-desc' ? 'i-ri-arrow-down-line' : 'i-ri-arrow-up-line',
                          !sort && 'opacity-40',
                        )}
                      />
                    </button>
                  </th>
                  <th className="hidden pb-2 font-medium sm:table-cell">
                    {t(($) => $['metadata.createMetadata.type'])}
                  </th>
                  <th className="pb-2 font-medium">{t(($) => $['newKnowledge.statusColumn'])}</th>
                  <th className="hidden pb-2 font-medium lg:table-cell">
                    {t(($) => $['newKnowledge.syncPolicyColumn'])}
                  </th>
                  <th className="hidden pb-2 font-medium lg:table-cell">
                    {t(($) => $['newKnowledge.lastSyncColumn'])}
                  </th>
                  <th aria-label={t(($) => $['newKnowledge.actionsColumn'])} />
                </tr>
              </thead>
              <tbody>
                {filteredSources.map((source) => (
                  <SourceRow
                    key={source.id}
                    canEdit={canManageSources}
                    canSync={canManageSources}
                    source={source}
                    knowledgeSpaceId={knowledgeSpaceId}
                    checked={selectedSourceIds.has(source.id)}
                    onRemoved={() => {
                      setRemovedSourceIds((current) => new Set(current).add(source.id))
                      setSelectedSourceIds((current) => {
                        if (!current.has(source.id)) return current
                        const next = new Set(current)
                        next.delete(source.id)
                        return next
                      })
                    }}
                    onSourceChange={(updatedSource) =>
                      setSourceOverrides((current) => ({
                        ...current,
                        [updatedSource.id]: updatedSource,
                      }))
                    }
                    onCheckedChange={(checked) => {
                      setSelectedSourceIds((current) => {
                        const next = new Set(current)
                        if (checked) next.add(source.id)
                        else next.delete(source.id)
                        return next
                      })
                    }}
                  />
                ))}
              </tbody>
            </table>
            {!filteredSources.length &&
              !completingFilteredResults &&
              !sourcesQuery.isFetchNextPageError && (
                <p className="py-16 text-center body-sm-regular text-text-tertiary">
                  {t(($) => $['newKnowledge.noMatchingSources'])}
                </p>
              )}
            {!filteredSources.length && completingFilteredResults && (
              <div className="flex min-h-40 items-center justify-center">
                <Loading />
              </div>
            )}
          </div>
          {sourcesQuery.isFetchNextPageError ? (
            <div className="mt-5 flex items-center justify-center gap-3" role="alert">
              <span className="system-xs-regular text-text-destructive">
                {t(($) => $['newKnowledge.sourcesErrorDescription'])}
              </span>
              <Button onClick={() => void sourcesQuery.fetchNextPage()}>
                {tCommon(($) => $['operation.retry'])}
              </Button>
            </div>
          ) : sourcesQuery.hasNextPage && !completingFilteredResults ? (
            <div className="mt-5 flex justify-center">
              <Button
                loading={sourcesQuery.isFetchingNextPage}
                onClick={() => void sourcesQuery.fetchNextPage()}
              >
                {t(($) => $['newKnowledge.loadMore'])}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </main>
  )
}
