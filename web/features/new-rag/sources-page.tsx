'use client'

import type { StatusDotStatus } from '@langgenius/dify-ui/status-dot'
import type { Source } from './source-models'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { toast } from '@langgenius/dify-ui/toast'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { SearchInput } from '@/app/components/base/search-input'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import Link from '@/next/link'
import { consoleClient, consoleQuery } from '@/service/client'
import { hasPermission } from '@/utils/permission'
import { KnowledgeModelSetupDialog } from './components/knowledge-model-setup-dialog'
import { newKnowledgeAddSourcePath } from './routes'
import { sourceFromApi, sourceWorkflowFromApi } from './source-models'
import { useKnowledgeModelSetupGuard } from './use-knowledge-model-setup-guard'

type SourceStatus = Source['status']
type SourceFilter = SourceStatus | 'all'
type SourceSort = 'name-asc' | 'name-desc'

const PAGE_SIZE = 50
const MAX_AUTO_FILTER_PAGES = 4
const SOURCE_POLL_INTERVAL = 3000
const SOURCE_WORKFLOW_POLL_INTERVAL = 1500
const SOURCE_WORKFLOW_SUCCESS_STATES = new Set([
  'complete',
  'completed',
  'success',
  'succeeded',
  'zero_results',
])
const SOURCE_WORKFLOW_FAILURE_STATES = new Set([
  'canceled',
  'cancelled',
  'error',
  'exhausted',
  'failed',
  'timed_out',
  'timeout',
])

const statusDotStatus: Record<SourceStatus, StatusDotStatus> = {
  active: 'success',
  syncing: 'normal',
  disabled: 'disabled',
  error: 'error',
}

const emptySourceShortcuts = [
  {
    brand: 'firecrawl',
    iconClass: 'i-custom-public-common-firecrawl',
    provider: 'Firecrawl',
    sourceType: 'websiteCrawl',
  },
  {
    brand: 'jina',
    iconClass: 'i-custom-public-llm-jina',
    provider: 'Jina Reader',
    sourceType: 'websiteCrawl',
  },
  {
    brand: 'notion',
    iconClass: 'i-custom-public-common-notion text-text-primary',
    provider: 'Notion',
    sourceType: 'onlineDocuments',
  },
  {
    brand: 'google-drive',
    iconClass: 'i-custom-public-common-google-drive',
    provider: 'Google Drive',
    sourceType: 'onlineDrive',
  },
  {
    brand: 'confluence',
    iconClass: 'i-custom-public-common-confluence',
    provider: 'Confluence',
    sourceType: 'onlineDocuments',
  },
] as const

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

function normalizedWorkflowState(state: string) {
  return state.trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_')
}

function sourceWorkflowStatus(state: string): SourceStatus {
  const normalized = normalizedWorkflowState(state)
  if (SOURCE_WORKFLOW_FAILURE_STATES.has(normalized)) return 'error'
  if (SOURCE_WORKFLOW_SUCCESS_STATES.has(normalized)) return 'active'
  return 'syncing'
}

function getOpenableSourceUri(uri: string) {
  try {
    const url = new URL(uri)
    if (url.protocol === 's3:' && url.hostname) {
      const prefix = decodeURIComponent(url.pathname.replace(/^\//, ''))
      const consoleUrl = new URL(`https://s3.console.aws.amazon.com/s3/buckets/${url.hostname}`)
      if (prefix) consoleUrl.searchParams.set('prefix', prefix)
      return consoleUrl.toString()
    }
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
        <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-[200px]">
          {canSync && (
            <DropdownMenuItem
              onClick={() => void onSync()}
              className="mb-px h-7 gap-2 px-2 system-sm-medium"
            >
              <span aria-hidden className="i-ri-refresh-line size-4" />
              {t(($) => $['newKnowledge.syncNow'])}
            </DropdownMenuItem>
          )}
          {sourceUri && (
            <DropdownMenuLinkItem
              render={
                <a
                  aria-label={t(($) => $['newKnowledge.editSource'])}
                  href={sourceUri}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
              className="mb-px h-7 gap-2 px-2 system-sm-medium"
            >
              <span aria-hidden className="i-ri-edit-line size-4" />
              {t(($) => $['newKnowledge.editSource'])}
            </DropdownMenuLinkItem>
          )}
          {canEdit && (
            <>
              <DropdownMenuItem
                onClick={() => void onToggle()}
                className="h-7 gap-2 px-2 system-sm-medium"
              >
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
              <DropdownMenuSeparator className="my-px" />
              <DropdownMenuItem
                onClick={() => setRemoveDialogOpen(true)}
                variant="destructive"
                className="h-7 gap-2 px-2 system-sm-medium"
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
  ensureModelSetupReady,
  knowledgeSpaceId,
  onCheckedChange,
  onSourceReconciled,
  onRemoved,
  onSourceChange,
  source,
}: {
  canEdit: boolean
  canSync: boolean
  checked: boolean
  ensureModelSetupReady: () => Promise<boolean>
  knowledgeSpaceId: string
  onCheckedChange: (checked: boolean) => void
  onSourceReconciled: () => void
  onRemoved: () => void
  onSourceChange: (source: Source) => void
  source: Source
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const [pendingAction, setPendingAction] = useState<SourceAction>()
  const [acceptedSyncRun, setAcceptedSyncRun] = useState<ReturnType<typeof sourceWorkflowFromApi>>()
  const syncWorkflowQuery = useQuery({
    ...consoleQuery.knowledgeFs.spaces.byControlSpaceId.sourceWorkflows.byRunId.get.queryOptions({
      input: {
        params: {
          control_space_id: knowledgeSpaceId,
          run_id: acceptedSyncRun?.id ?? '',
        },
      },
    }),
    enabled: Boolean(acceptedSyncRun),
    refetchInterval: (query) => {
      const workflow = query.state.data ? sourceWorkflowFromApi(query.state.data) : acceptedSyncRun
      return workflow && sourceWorkflowStatus(workflow.state) === 'syncing'
        ? SOURCE_WORKFLOW_POLL_INTERVAL
        : false
    },
  })
  const syncWorkflow = syncWorkflowQuery.data
    ? sourceWorkflowFromApi(syncWorkflowQuery.data)
    : acceptedSyncRun
  const visibleSource = syncWorkflow
    ? { ...source, status: sourceWorkflowStatus(syncWorkflow.state) }
    : source
  const providerName = metadataString(source.metadata, 'providerName')
  const syncPolicy = metadataString(source.metadata, 'syncPolicy')
  const lastSync = metadataString(source.metadata, 'lastSyncedAt')
  const typeLabel =
    source.type === 'connector' &&
    (providerName === 'Notion' || providerName === 'Google Docs' || providerName === 'Confluence')
      ? t(($) => $['newKnowledge.onlineDocuments'])
      : t(($) => $[`newKnowledge.sourceType.${source.type}`])
  const sourceIcon =
    source.type === 'web'
      ? 'i-ri-global-line'
      : providerName === 'Notion'
        ? 'i-custom-public-common-notion'
        : providerName === 'Amazon S3'
          ? 'i-ri-folder-line'
          : providerName === 'Google Docs'
            ? 'i-ri-file-text-fill text-[#4d8bf5]'
            : 'i-ri-links-line'

  const runAction = async <Result,>(
    action: SourceAction,
    mutation: () => Promise<Result>,
    onAccepted?: (result: Result) => void,
    onRefreshed?: () => void,
    beforeAction?: () => Promise<boolean>,
  ) => {
    if (pendingAction) return false
    setPendingAction(action)
    try {
      if (beforeAction && !(await beforeAction())) return false
      let result: Result
      try {
        result = await mutation()
      } catch {
        toast.error(t(($) => $['newKnowledge.sourcesErrorDescription']))
        try {
          await queryClient.invalidateQueries({
            queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.sources.get.key(),
          })
        } catch {
          return false
        }
        return false
      }
      onAccepted?.(result)

      try {
        await queryClient.invalidateQueries({
          queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.sources.get.key(),
        })
        onRefreshed?.()
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
        consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.sync.post({
          headers: { 'Idempotency-Key': createIdempotencyKey() },
          params: { control_space_id: knowledgeSpaceId, source_id: source.id },
        }),
      (workflow) => {
        const run = sourceWorkflowFromApi(workflow)
        setAcceptedSyncRun(run)
        onSourceChange({ ...source, status: sourceWorkflowStatus(run.state) })
      },
      onSourceReconciled,
      ensureModelSetupReady,
    )

  const toggleSource = () =>
    runAction(
      'toggle',
      async () =>
        sourceFromApi(
          await consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.patch({
            body: {
              ...(source.version === undefined ? {} : { expectedVersion: source.version }),
              status: source.status === 'disabled' ? 'active' : 'disabled',
            },
            params: { control_space_id: knowledgeSpaceId, source_id: source.id },
          }),
        ),
      onSourceChange,
    )

  const removeSource = () =>
    runAction(
      'remove',
      async () => {
        if (source.version === undefined) throw new Error('Source version is required')
        return consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.delete({
          body: { expectedRevision: source.version },
          headers: { 'Idempotency-Key': createIdempotencyKey() },
          params: { control_space_id: knowledgeSpaceId, source_id: source.id },
          query: { documents: 'keep' },
        })
      },
      onRemoved,
    )

  return (
    <tr
      className={cn(
        'border-t border-divider-subtle',
        visibleSource.status === 'disabled' && '[&>td:not(:first-child)]:opacity-60',
      )}
    >
      <td className="w-7 py-2 pr-3">
        <Checkbox aria-label={source.name} checked={checked} onCheckedChange={onCheckedChange} />
      </td>
      <td className="min-w-0 py-2 pr-3 sm:min-w-64">
        <div className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden className={cn('size-4.5 shrink-0 text-text-tertiary', sourceIcon)} />
          <div className="min-w-0">
            <p className="truncate system-xs-medium text-text-primary">{source.name}</p>
          </div>
        </div>
      </td>
      <td className="hidden w-45 py-2 pr-3 sm:table-cell">
        <p className="system-xs-regular text-text-secondary">{providerName ?? typeLabel}</p>
        {providerName && <p className="system-2xs-regular text-text-tertiary">{typeLabel}</p>}
      </td>
      <td className="w-24 py-2 pr-3 sm:w-35">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 system-xs-medium text-text-primary',
            visibleSource.status === 'syncing' && 'text-text-accent',
          )}
        >
          <StatusDot
            status={statusDotStatus[visibleSource.status]}
            className={cn(
              'shrink-0',
              visibleSource.status === 'syncing' && 'animate-pulse motion-reduce:animate-none',
            )}
          />
          {t(($) => $[`newKnowledge.sourceStatus.${visibleSource.status}`])}
        </span>
      </td>
      <td className="hidden w-30 py-2 pr-3 system-xs-regular text-text-secondary lg:table-cell">
        {syncPolicy ?? '—'}
      </td>
      <td
        className={cn(
          'hidden w-40 py-2 pr-3 system-xs-regular lg:table-cell',
          visibleSource.status === 'error' ? 'text-text-destructive' : 'text-text-secondary',
        )}
      >
        {visibleSource.status === 'syncing' && syncWorkflow ? (
          <span className="inline-flex items-center gap-1.5 text-text-accent">
            <span
              aria-hidden
              className="i-ri-loader-4-line size-3.5 animate-spin motion-reduce:animate-none"
            />
            {t(($) => $['newKnowledge.sourceSyncProgress'], {
              completed:
                syncWorkflow.progressCompleted +
                syncWorkflow.progressFailed +
                syncWorkflow.progressSkipped,
              total: syncWorkflow.progressTotal ?? '—',
            })}
          </span>
        ) : visibleSource.status === 'error' ? (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="i-ri-error-warning-fill size-3.5" />
            {syncWorkflow?.lastErrorCode ?? t(($) => $['newKnowledge.sourceSyncFailed'])}
          </span>
        ) : (
          (lastSync ?? '—')
        )}
      </td>
      <td className="w-20 py-2 text-right">
        <div className="flex items-center justify-end gap-1">
          {canSync && visibleSource.status === 'error' && (
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
            source={visibleSource}
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
    <div className="mt-2.5 flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex items-center gap-3 opacity-85">
        {emptySourceShortcuts.map((shortcut) => {
          const icon = (
            <span
              key={shortcut.brand}
              aria-hidden
              data-brand={shortcut.brand}
              className={`${shortcut.iconClass} size-8`}
            />
          )
          if (!canAddSource) return icon
          return (
            <Link
              key={shortcut.brand}
              href={newKnowledgeAddSourcePath(knowledgeSpaceId, {
                provider: shortcut.provider,
                sourceType: shortcut.sourceType,
              })}
              className="inline-flex size-8 rounded-md outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            >
              {icon}
              <span className="sr-only">{shortcut.provider}</span>
            </Link>
          )
        })}
        {canAddSource ? (
          <Link
            aria-label={t(($) => $['newKnowledge.moreProviders'])}
            href={newKnowledgeAddSourcePath(knowledgeSpaceId)}
            className="inline-flex size-8 rounded-md outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          >
            <span
              aria-hidden
              data-brand="more"
              className="i-ri-more-fill size-8 text-text-quaternary"
            />
          </Link>
        ) : (
          <span
            aria-hidden
            data-brand="more"
            className="i-ri-more-fill size-8 text-text-quaternary"
          />
        )}
      </div>
      <div className="flex flex-col items-center gap-1.5 pt-1.5">
        <h2 className="title-xl-semi-bold text-text-primary">
          {t(($) => $['newKnowledge.sourcesEmptyTitle'])}
        </h2>
        <p className="w-full max-w-110 body-sm-regular text-text-tertiary">
          {t(($) => $['newKnowledge.sourcesEmptyDescription'])}
        </p>
      </div>
      {canAddSource && (
        <Link
          href={newKnowledgeAddSourcePath(knowledgeSpaceId)}
          className="inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-components-button-primary-bg px-3.5 system-sm-medium text-components-button-primary-text shadow-sm outline-hidden hover:bg-components-button-primary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
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
  const {
    configureModelSetup,
    ensureModelSetupReady,
    modelSetupDialogOpen,
    setModelSetupDialogOpen,
  } = useKnowledgeModelSetupGuard(knowledgeSpaceId)
  const canManageSources = hasPermission(workspacePermissionKeys, 'dataset.external.connect')
  const [filter, setFilter] = useState<SourceFilter>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SourceSort>()
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(() => new Set())
  const [sourceOverrides, setSourceOverrides] = useState<Record<string, Source>>({})
  const [removedSourceIds, setRemovedSourceIds] = useState<Set<string>>(() => new Set())
  const sourcesQuery = useInfiniteQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.sources.get.infiniteOptions({
      input: (pageParam) => ({
        params: { control_space_id: knowledgeSpaceId },
        query: {
          limit: PAGE_SIZE,
          ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
        },
      }),
      getNextPageParam: (lastPage) => lastPage.next_cursor,
      initialPageParam: null as string | null,
      refetchInterval: (query) =>
        query.state.data?.pages.some((page) =>
          page.data.some(
            (source) =>
              !removedSourceIds.has(source.id) &&
              getCurrentSource(sourceFromApi(source), sourceOverrides[source.id]).status ===
                'syncing',
          ),
        )
          ? SOURCE_POLL_INTERVAL
          : false,
    }),
  )
  const remoteSources = sourcesQuery.data?.pages.flatMap((page) => page.data.map(sourceFromApi))
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
    latestSourcePage.data.some((source) =>
      isPreviewDraft(getCurrentSource(sourceFromApi(source), sourceOverrides[source.id])),
    ) &&
    !latestSourcePage.data.some((source) => {
      if (removedSourceIds.has(source.id)) return false
      return !isPreviewDraft(getCurrentSource(sourceFromApi(source), sourceOverrides[source.id]))
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
    <div className="flex min-h-full min-w-0 flex-1 flex-col px-4 py-6 sm:px-8 sm:py-8">
      <header>
        <div>
          <h2 className="title-xl-semi-bold leading-6 text-text-primary">
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
            <Select<SourceFilter>
              value={filter}
              onValueChange={(value) => {
                if (value) setFilter(value)
              }}
            >
              <SelectLabel className="sr-only">
                {t(($) => $['newKnowledge.sourceFilterLabel'])}
              </SelectLabel>
              <SelectTrigger className="sm:w-35">
                {filter === 'all'
                  ? t(($) => $['newKnowledge.allSources'])
                  : t(($) => $[`newKnowledge.sourceStatus.${filter}`])}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  <SelectItemText>{t(($) => $['newKnowledge.allSources'])}</SelectItemText>
                  <SelectItemIndicator />
                </SelectItem>
                {(['active', 'syncing', 'disabled', 'error'] as const).map((status) => (
                  <SelectItem key={status} value={status}>
                    <SelectItemText>
                      {t(($) => $[`newKnowledge.sourceStatus.${status}`])}
                    </SelectItemText>
                    <SelectItemIndicator />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <SearchInput
              aria-label={t(($) => $['newKnowledge.searchSources'])}
              className="sm:w-60"
              value={search}
              onValueChange={setSearch}
              placeholder={t(($) => $['newKnowledge.searchSources'])}
            />
            {canManageSources && (
              <Link
                href={newKnowledgeAddSourcePath(knowledgeSpaceId)}
                className={buttonVariants({
                  className: 'gap-1 sm:ml-auto',
                  variant: 'primary',
                })}
              >
                <span aria-hidden className="i-ri-add-line size-4" />
                {t(($) => $['newKnowledge.addSource'])}
              </Link>
            )}
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full table-fixed border-collapse text-left lg:min-w-225 lg:table-auto">
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
                    <Button
                      variant="ghost"
                      size="small"
                      onClick={() =>
                        setSort((current) => (current === 'name-asc' ? 'name-desc' : 'name-asc'))
                      }
                      className="h-auto gap-1 rounded px-0"
                    >
                      {t(($) => $['newKnowledge.sourceColumn'])}
                      {sort && (
                        <span
                          aria-hidden
                          className={cn(
                            'size-3.5',
                            sort === 'name-desc' ? 'i-ri-arrow-down-line' : 'i-ri-arrow-up-line',
                          )}
                        />
                      )}
                    </Button>
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
                    checked={selectedSourceIds.has(source.id)}
                    ensureModelSetupReady={ensureModelSetupReady}
                    knowledgeSpaceId={knowledgeSpaceId}
                    source={source}
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
                    onSourceReconciled={() =>
                      setSourceOverrides((current) => {
                        if (!current[source.id]) return current
                        const next = { ...current }
                        delete next[source.id]
                        return next
                      })
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
      <KnowledgeModelSetupDialog
        open={modelSetupDialogOpen}
        onOpenChange={setModelSetupDialogOpen}
        onConfigure={configureModelSetup}
      />
    </div>
  )
}
