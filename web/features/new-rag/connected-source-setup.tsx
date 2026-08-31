'use client'

import type {
  KnowledgeFsSourceFileResponse,
  KnowledgeFsSourcePageResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { DatasourceParameters, DatasourceParameterSchema } from './datasource-parameter-model'
import type { Source, SourceConnection, SourceProvider } from './source-models'
import type { SourceProviderOption } from './source-provider-options'
import type {
  NewKnowledgeOnlineDocumentsSourceDraft,
  NewKnowledgeOnlineDriveSourceDraft,
  NewKnowledgeSourceDraft,
} from './sources/create/source-draft'
import type {
  DataSourceAuth,
  DataSourceCredential,
} from '@/app/components/header/account-setting/data-source-page-new/types'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { buildIntegrationPath } from '@/app/components/integrations/routes'
import { consoleClient, consoleQuery } from '@/service/client'
import { useGetDataSourceListAuth } from '@/service/use-datasource'
import { useDataSourceList } from '@/service/use-pipeline'
import { formatFileSize } from '@/utils/format'
import { DatasourceParameterForm } from './datasource-parameter-form'
import {
  datasourceParameterDefaults,
  datasourceParameterSchemas,
  invalidDatasourceParameters,
  missingRequiredDatasourceParameters,
  withDatasourceParameterDefaults,
} from './datasource-parameter-model'
import { createRequestId } from './request-id'
import {
  sourceConnectionFromApi,
  sourceConnectionListFromApi,
  sourceFromApi,
  sourceHasPendingAsyncImport,
  sourceProviderListFromApi,
  sourceWorkflowFromApi,
} from './source-models'
import {
  discoverSourceProviderOptions,
  normalizeSourceProviderName,
  sourceProviderOptionForDraft,
} from './source-provider-options'
import {
  SourceNameField,
  SourceProviderCredentialRequiredCard,
  SourceProviderIcon,
  SourceProviderNotInstalledCard,
  SourceProviderSelector,
  SourceSyncPolicyField,
} from './source-setup-fields'
import {
  findSourceProviderConnection,
  sourceConnectionMatchesDatasource,
  sourceProviderUsesManagedConfiguration,
} from './sources/connections/model'
import { NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH } from './sources/create/source-draft'

type ConnectedSourceDraft =
  | NewKnowledgeOnlineDocumentsSourceDraft
  | NewKnowledgeOnlineDriveSourceDraft
type PageResource = {
  ancestorKeys: string[]
  depth: number
  descendantKeys: string[]
  groupId: string
  groupName: string
  hasChildren: boolean
  key: string
  kind: 'page'
  page: KnowledgeFsSourcePageResponse
}
type FileResource = {
  ancestorKeys: string[]
  bucket?: string
  depth: number
  file: KnowledgeFsSourceFileResponse
  key: string
  kind: 'file'
}
type SelectableResource = FileResource | PageResource
type FilePageParam = { bucket?: string; continuationToken: string } | null
type DriveBranch = {
  children: FileResource[]
  error: boolean
  loaded: boolean
  loading: boolean
}

const CONNECTION_PAGE_SIZE = 200
const RESOURCE_PAGE_SIZE = 200
const MAX_SELECTION = 200
const MAX_SOURCE_CURSOR_PAGES = 100

function usesDriveTransport(draft: ConnectedSourceDraft) {
  return draft.sourceType === 'onlineDrive' || draft.provider === 'Google Docs'
}

function providerForDraft(
  providers: SourceProvider[],
  draft: ConnectedSourceDraft,
  option?: SourceProviderOption,
) {
  const capability = usesDriveTransport(draft) ? 'online-drive' : 'online-document'
  const aliases = new Set(
    [draft.provider, option?.label ?? ''].map(normalizeSourceProviderName).filter(Boolean),
  )
  const capableProviders = providers.filter((provider) =>
    provider.capabilities.includes(capability),
  )
  return (
    capableProviders.find((provider) => {
      const names = [provider.id, provider.displayName].map(normalizeSourceProviderName)
      return names.some(
        (name) =>
          aliases.has(name) ||
          [...aliases].some((alias) => name.includes(alias) || alias.includes(name)),
      )
    }) ??
    capableProviders.find((provider) => {
      return sourceProviderUsesManagedConfiguration(provider.configuration)
    })
  )
}

function datasourceProviderForOption(option?: SourceProviderOption) {
  return option?.installed
    ? {
        datasource: option.datasource,
        plugin: option.plugin,
      }
    : undefined
}

function datasourceProviderIcon(
  datasourceProvider: ReturnType<typeof datasourceProviderForOption>,
) {
  return datasourceProvider?.plugin.declaration.identity.icon
}

function credentialRegion(credential: DataSourceCredential | undefined) {
  const region = Object.entries(credential?.credential ?? {}).find(
    ([key, value]) =>
      ['awsregion', 'region', 'regionname'].includes(normalizeSourceProviderName(key)) &&
      typeof value === 'string' &&
      value.trim(),
  )?.[1]
  return typeof region === 'string' ? region.trim() : undefined
}

function datasourceAuthForProvider(
  providers: DataSourceAuth[],
  datasourceProvider: ReturnType<typeof datasourceProviderForOption>,
) {
  if (!datasourceProvider) return undefined
  return providers.find(
    (provider) =>
      provider.plugin_id === datasourceProvider.plugin.plugin_id &&
      provider.provider === datasourceProvider.plugin.provider,
  )
}

function preferredCredential(provider?: DataSourceAuth) {
  return (
    provider?.credentials_list.find((credential) => credential.is_default) ??
    provider?.credentials_list[0]
  )
}

function providerIntegrationPath(option?: SourceProviderOption) {
  const base = buildIntegrationPath('data-source')
  if (!option) return base
  const query = new URLSearchParams({ 'package-ids': JSON.stringify([option.packageId]) })
  return `${base}?${query.toString()}`
}

function providerScheme(providerName: string) {
  const normalized = normalizeSourceProviderName(providerName)
  if (normalized.includes('notion')) return 'notion'
  if (normalized.includes('googledocs')) return 'gdocs'
  if (normalized.includes('googledrive')) return 'gdrive'
  if (normalized.includes('onedrive')) return 'onedrive'
  if (normalized.includes('confluence')) return 'confluence'
  if (normalized.includes('s3')) return 's3'
  return 'connector'
}

function sourceUri(
  provider: SourceProvider,
  connection: SourceConnection,
  draft: ConnectedSourceDraft,
) {
  const scheme = providerScheme(`${draft.provider} ${provider.id} ${provider.displayName}`)
  if (scheme === 's3') {
    const bucket = Object.entries(connection.configuration).find(([key]) =>
      ['bucket', 'bucketname'].includes(normalizeSourceProviderName(key)),
    )?.[1]
    if (typeof bucket === 'string' && bucket.trim()) return `s3://${bucket.trim()}`
  }
  return `${scheme}://${connection.id}`
}

function sourceType() {
  return 'connector' as const
}

async function findSourceByClientRequestId(knowledgeSpaceId: string, clientRequestId: string) {
  const seenCursors = new Set<string>()
  let cursor: string | undefined
  let pages = 0
  do {
    pages += 1
    if (pages > MAX_SOURCE_CURSOR_PAGES) throw new Error('Source cursor limit exceeded')
    const response = await consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.get({
      params: { control_space_id: knowledgeSpaceId },
      query: cursor ? { cursor } : {},
    })
    const match = response.data
      .map((source) => sourceFromApi(source))
      .find((source) => source.metadata.clientRequestId === clientRequestId)
    if (match) return match
    const nextCursor = response.next_cursor ?? undefined
    if (!nextCursor || seenCursors.has(nextCursor)) return undefined
    seenCursors.add(nextCursor)
    cursor = nextCursor
  } while (cursor)
  return undefined
}

async function deleteSourceBestEffort(knowledgeSpaceId: string, source?: Source) {
  if (!source?.version) return
  try {
    await consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.delete({
      body: { expectedRevision: source.version },
      headers: { 'Idempotency-Key': createRequestId() },
      params: { control_space_id: knowledgeSpaceId, source_id: source.id },
      query: { documents: 'cascade' },
    })
  } catch {
    // Cleanup is best effort; a failed cleanup remains visible and recoverable in Sources.
  }
}

function connectionLabel(
  connection: SourceConnection,
  resources: SelectableResource[],
  providerRegion?: string,
) {
  if (resources[0]?.kind === 'page') return resources[0].groupName
  if (resources[0]?.kind === 'file' && resources[0].bucket)
    return `s3://${resources[0].bucket}${providerRegion ? ` · ${providerRegion}` : ''}`
  const email = Object.values(connection.configuration).find(
    (value) => typeof value === 'string' && value.includes('@'),
  )
  return typeof email === 'string' ? email : connection.name
}

function fileResource(
  file: KnowledgeFsSourceFileResponse,
  bucket: string | undefined,
  parent?: FileResource,
): FileResource {
  return {
    ancestorKeys: parent ? [...parent.ancestorKeys, parent.key] : [],
    bucket,
    depth: parent ? parent.depth + 1 : 0,
    file,
    key: `file:${bucket ?? ''}:${file.id}`,
    kind: 'file',
  }
}

function resourceName(resource: SelectableResource) {
  return resource.kind === 'page' ? resource.page.page_name : resource.file.name
}

function resourceType(resource: SelectableResource) {
  return resource.kind === 'page' ? resource.page.type : resource.file.type
}

function isFolder(resource: SelectableResource) {
  return /folder|directory|workspace/i.test(resourceType(resource))
}

function isBucket(resource: SelectableResource) {
  return resource.kind === 'file' && /bucket/i.test(resource.file.type)
}

function isDriveContainer(resource: SelectableResource) {
  return resource.kind === 'file' && (isBucket(resource) || isFolder(resource))
}

function isExpandableResource(resource: SelectableResource) {
  return resource.kind === 'page' ? resource.hasChildren : isDriveContainer(resource)
}

function isSelectableResource(resource: SelectableResource) {
  return resource.kind === 'page' || !isDriveContainer(resource)
}

function hasDriveFolderCheckbox(resource: SelectableResource) {
  return resource.kind === 'file' && isFolder(resource)
}

function resourceIcon(resource: SelectableResource) {
  if (isFolder(resource) || isBucket(resource)) return 'i-ri-folder-3-fill text-text-warning'
  if (resource.kind === 'page' && /database/i.test(resource.page.type))
    return 'i-ri-database-2-line text-text-accent'
  if (resource.kind === 'page') return 'i-ri-file-text-line text-text-tertiary'
  return 'i-ri-file-3-line text-text-tertiary'
}

function ResourceList({
  collapsed,
  connection,
  driveBranches,
  driveDescendantLeafKeys,
  expandedDriveContainers,
  folderSelectionIntents,
  hasMore,
  loadingMore,
  onLoadMore,
  onToggle,
  onToggleAll,
  onToggleExpanded,
  providerRegion,
  resources,
  selectionAtLimit,
  selectionLimitId,
  selectionLimitVisible,
  selectionPending,
  selectionScope,
  selected,
}: {
  collapsed: ReadonlySet<string>
  connection: SourceConnection
  driveBranches: ReadonlyMap<string, DriveBranch>
  driveDescendantLeafKeys: ReadonlyMap<string, string[]>
  expandedDriveContainers: ReadonlySet<string>
  folderSelectionIntents: ReadonlySet<string>
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  onToggle: (resource: SelectableResource) => void
  onToggleAll: () => void
  onToggleExpanded: (resource: SelectableResource) => void
  providerRegion?: string
  resources: SelectableResource[]
  selectionAtLimit: boolean
  selectionLimitId: string
  selectionLimitVisible: boolean
  selectionPending: boolean
  selectionScope: SelectableResource[]
  selected: ReadonlyMap<string, SelectableResource>
}) {
  const { t } = useTranslation('dataset')
  const selectableResources = selectionScope.filter(isSelectableResource)
  const driveContainers = selectionScope.filter(isDriveContainer)
  const allDriveContainersLoaded = driveContainers.every(
    (resource) => driveBranches.get(resource.key)?.loaded,
  )
  const hasSelectionCandidates =
    selectableResources.length > 0 ||
    driveContainers.some((resource) => !driveBranches.get(resource.key)?.loaded)
  const allSelected =
    selectableResources.length > 0 &&
    allDriveContainersLoaded &&
    selectableResources.every((item) => selected.has(item.key))
  const someSelected = selectableResources.some((item) => selected.has(item.key))

  return (
    <div className="flex h-78 flex-col overflow-hidden rounded-xl border border-divider-regular">
      <div className="flex h-7.5 shrink-0 items-center gap-2 border-b border-divider-subtle px-3">
        <Checkbox
          aria-label={t(($) => $['newKnowledge.selectAll'])}
          aria-describedby={selectionLimitVisible && !allSelected ? selectionLimitId : undefined}
          checked={allSelected}
          disabled={
            selectionPending || !hasSelectionCandidates || (selectionAtLimit && !allSelected)
          }
          indeterminate={!allSelected && someSelected}
          onCheckedChange={onToggleAll}
        />
        <span className="system-xs-medium text-text-primary">
          {t(($) => $['newKnowledge.selectAll'])}
        </span>
        <span className="ml-auto truncate system-xs-regular text-text-tertiary">
          {connectionLabel(connection, resources, providerRegion)}
        </span>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto py-1" aria-live="polite">
        {resources.map((resource) => {
          const expandable = isExpandableResource(resource)
          const selectionKeys =
            resource.kind === 'page'
              ? [resource.key, ...resource.descendantKeys]
              : isDriveContainer(resource)
                ? (driveDescendantLeafKeys.get(resource.key) ?? [])
                : [resource.key]
          const hasSelectionKeys = selectionKeys.length > 0
          const folderSelectionPending =
            resource.kind === 'file' && folderSelectionIntents.has(resource.key)
          const checked =
            folderSelectionPending ||
            (hasSelectionKeys && selectionKeys.every((key) => selected.has(key)))
          const indeterminate = !checked && selectionKeys.some((key) => selected.has(key))
          const driveBranch = resource.kind === 'file' ? driveBranches.get(resource.key) : undefined
          const emptyDriveFolder =
            hasDriveFolderCheckbox(resource) && driveBranch?.loaded && !selectionKeys.length
          const selectionBlocked = selectionAtLimit && !checked
          const checkboxDisabled =
            selectionBlocked || emptyDriveFolder || Boolean(driveBranch?.loading)
          const expanded =
            resource.kind === 'page'
              ? !collapsed.has(resource.key)
              : expandedDriveContainers.has(resource.key)
          const rendersCheckbox =
            resource.kind === 'page' ||
            hasDriveFolderCheckbox(resource) ||
            isSelectableResource(resource)
          return (
            <li
              key={resource.key}
              className={cn('flex items-center gap-2 pe-3', expandable ? 'h-8.5' : 'h-7.5')}
              style={{
                paddingInlineStart: `${12 + resource.depth * 26}px`,
              }}
            >
              {expandable ? (
                <button
                  type="button"
                  aria-label={resourceName(resource)}
                  aria-expanded={expanded}
                  className="flex size-5 items-center justify-center rounded text-text-tertiary hover:bg-state-base-hover"
                  onClick={() => onToggleExpanded(resource)}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'i-ri-arrow-right-s-line size-4 transition-transform motion-reduce:transition-none',
                      expanded && 'rotate-90',
                    )}
                  />
                </button>
              ) : (
                <span className="size-5" />
              )}
              {rendersCheckbox ? (
                <Checkbox
                  aria-label={resourceName(resource)}
                  aria-describedby={
                    selectionLimitVisible && !checked ? selectionLimitId : undefined
                  }
                  checked={checked}
                  disabled={checkboxDisabled}
                  indeterminate={indeterminate}
                  onCheckedChange={() => onToggle(resource)}
                />
              ) : (
                <span className="size-4 shrink-0" />
              )}
              <span aria-hidden className={`${resourceIcon(resource)} size-4 shrink-0`} />
              <span className="min-w-0 flex-1 truncate system-xs-regular text-text-primary">
                {resourceName(resource)}
              </span>
              {resource.kind === 'file' && resource.file.size != null && (
                <span className="system-xs-regular text-text-quaternary">
                  {formatFileSize(resource.file.size)}
                </span>
              )}
            </li>
          )
        })}
      </ul>
      {hasMore && (
        <div className="border-t border-divider-subtle px-3 py-2 text-center">
          <Button size="small" variant="ghost" loading={loadingMore} onClick={onLoadMore}>
            {t(($) => $['newKnowledge.loadMore'])}
          </Button>
        </div>
      )}
    </div>
  )
}

function ConnectedSourceSyncPolicyField({
  draft,
  onDraftChange,
}: {
  draft: ConnectedSourceDraft
  onDraftChange: (draft: NewKnowledgeSourceDraft) => void
}) {
  return (
    <SourceSyncPolicyField draft={draft} triggerClassName="w-75.25" onDraftChange={onDraftChange} />
  )
}

function ResourceConfiguration({
  connection,
  draft,
  knowledgeSpaceId,
  onCompleted,
  onDraftChange,
  onDirtyChange,
  onExit,
  parameters,
  provider,
  providerRegion,
}: {
  connection: SourceConnection
  draft: ConnectedSourceDraft
  knowledgeSpaceId: string
  onCompleted: () => void
  onDraftChange: (draft: NewKnowledgeSourceDraft) => void
  onDirtyChange: (dirty: boolean) => void
  onExit: () => void
  parameters: DatasourceParameters
  provider: SourceProvider
  providerRegion?: string
}) {
  const { t } = useTranslation('dataset')
  const queryClient = useQueryClient()
  const previewRequestIdRef = useRef(createRequestId())
  const importRequestRef = useRef<{ fingerprint: string; requestId: string } | undefined>(undefined)
  const previewSourceRef = useRef<Source | undefined>(undefined)
  const committedRef = useRef(false)
  const [previewSource, setPreviewSource] = useState<Source>()
  const [previewError, setPreviewError] = useState(false)
  const [selected, setSelected] = useState<Map<string, SelectableResource>>(() => new Map())
  const selectedRef = useRef<Map<string, SelectableResource>>(new Map())
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [driveBranches, setDriveBranches] = useState<Map<string, DriveBranch>>(() => new Map())
  const [expandedDriveContainers, setExpandedDriveContainers] = useState<Set<string>>(
    () => new Set(),
  )
  const [folderSelectionIntents, setFolderSelectionIntents] = useState<Set<string>>(() => new Set())
  const [selectingAll, setSelectingAll] = useState(false)
  const [selectionLimitError, setSelectionLimitError] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(false)
  const driveBranchesRef = useRef<Map<string, DriveBranch>>(new Map())
  const driveLoadPromisesRef = useRef<Map<string, Promise<FileResource[]>>>(new Map())
  const driveTransport = usesDriveTransport(draft)
  const previewUri = sourceUri(provider, connection, draft)
  const selectionAtLimit = selected.size >= MAX_SELECTION
  const selectionLimitVisible = selectionAtLimit || selectionLimitError
  const selectionPending = selectingAll || folderSelectionIntents.size > 0
  const selectionLimitId = 'connected-source-selection-limit'

  const updateSelected = useCallback(
    (
      update: (current: ReadonlyMap<string, SelectableResource>) => Map<string, SelectableResource>,
    ) => {
      const next = update(selectedRef.current)
      selectedRef.current = next
      setSelected(next)
    },
    [],
  )

  useEffect(() => {
    onDirtyChange(selected.size > 0)
  }, [onDirtyChange, selected.size])

  useEffect(() => {
    let active = true
    let source: Source | undefined
    committedRef.current = false
    const createPreviewSource = async () => {
      await Promise.resolve()
      if (!active) return
      setPreviewError(false)
      setPreviewSource(undefined)
      try {
        const clientRequestId = previewRequestIdRef.current
        try {
          source = sourceFromApi(
            await consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.post({
              body: {
                connectionId: connection.id,
                metadata: {
                  clientRequestId,
                  datasourceParameterMode: 'exact',
                  parameters,
                  preview: true,
                  providerId: provider.id,
                  providerKind: driveTransport ? 'online-drive' : 'online-document',
                  providerName: draft.provider,
                  sourceType: draft.sourceType,
                },
                name: draft.provider,
                permissionScope: [],
                status: 'disabled',
                type: sourceType(),
                uri: previewUri,
              },
              params: { control_space_id: knowledgeSpaceId },
            }),
          )
        } catch (error) {
          source = await findSourceByClientRequestId(knowledgeSpaceId, clientRequestId)
          if (!source) throw error
        }
        if (!active) {
          await deleteSourceBestEffort(knowledgeSpaceId, source)
          return
        }
        previewSourceRef.current = source
        setPreviewSource(source)
      } catch {
        if (active) setPreviewError(true)
      }
    }
    void createPreviewSource()
    return () => {
      active = false
      if (!committedRef.current)
        void deleteSourceBestEffort(knowledgeSpaceId, previewSourceRef.current ?? source)
      previewSourceRef.current = undefined
    }
  }, [
    connection.id,
    draft.provider,
    draft.sourceType,
    driveTransport,
    knowledgeSpaceId,
    parameters,
    previewUri,
    provider.id,
  ])

  const pagesQuery = useInfiniteQuery({
    queryKey: ['new-rag', 'connected-source-pages', knowledgeSpaceId, previewSource?.id],
    queryFn: ({ pageParam }) =>
      consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.pages.get({
        params: {
          control_space_id: knowledgeSpaceId,
          source_id: previewSource?.id ?? '',
        },
        query: {
          limit: RESOURCE_PAGE_SIZE,
          ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
        },
      }),
    enabled: !driveTransport && Boolean(previewSource),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    initialPageParam: null as string | null,
    retry: false,
  })
  const filesQuery = useInfiniteQuery({
    queryKey: ['new-rag', 'connected-source-files', knowledgeSpaceId, previewSource?.id],
    queryFn: ({ pageParam }) =>
      consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.files.get({
        params: {
          control_space_id: knowledgeSpaceId,
          source_id: previewSource?.id ?? '',
        },
        query: {
          maxKeys: RESOURCE_PAGE_SIZE,
          ...(pageParam?.bucket ? { bucket: pageParam.bucket } : {}),
          ...(pageParam?.continuationToken
            ? { continuationToken: pageParam.continuationToken }
            : {}),
        },
      }),
    enabled: driveTransport && Boolean(previewSource),
    getNextPageParam: (lastPage, _allPages, _lastPageParam, allPageParams) => {
      const candidate = lastPage.buckets.find(
        (bucket) => bucket.is_truncated && bucket.continuation_token,
      )
      if (!candidate?.continuation_token) return undefined
      const next: FilePageParam = {
        bucket: candidate.bucket ?? undefined,
        continuationToken: candidate.continuation_token,
      }
      return allPageParams.some(
        (page) =>
          page?.bucket === next.bucket && page?.continuationToken === next.continuationToken,
      )
        ? undefined
        : next
    },
    initialPageParam: null as FilePageParam,
    retry: false,
  })

  const pageResources = useMemo<PageResource[]>(() => {
    const groups = new Map<
      string,
      { name: string; pages: Map<string, KnowledgeFsSourcePageResponse> }
    >()
    for (const response of pagesQuery.data?.pages ?? []) {
      for (const workspace of response.workspaces) {
        const groupId = workspace.workspace_id?.trim() || 'workspace'
        const group = groups.get(groupId) ?? {
          name: workspace.workspace_name?.trim() || connection.name,
          pages: new Map<string, KnowledgeFsSourcePageResponse>(),
        }
        for (const page of workspace.pages) group.pages.set(page.page_id, page)
        groups.set(groupId, group)
      }
    }
    return [...groups].flatMap(([groupId, group]) => {
      const children = new Map<string, string[]>()
      for (const page of group.pages.values()) {
        const parentId = page.parent_id?.trim()
        if (!parentId || !group.pages.has(parentId)) continue
        children.set(parentId, [...(children.get(parentId) ?? []), page.page_id])
      }
      const keyFor = (pageId: string) => `page:${groupId}:${pageId}`
      const ancestorsFor = (page: KnowledgeFsSourcePageResponse) => {
        const ancestors: string[] = []
        const seen = new Set<string>([page.page_id])
        let parentId = page.parent_id?.trim()
        while (parentId && group.pages.has(parentId) && !seen.has(parentId)) {
          seen.add(parentId)
          ancestors.unshift(keyFor(parentId))
          parentId = group.pages.get(parentId)?.parent_id?.trim()
        }
        return ancestors
      }
      const descendantsFor = (pageId: string) => {
        const descendants: string[] = []
        const pending = [...(children.get(pageId) ?? [])]
        const seen = new Set<string>()
        while (pending.length) {
          const childId = pending.shift()
          if (!childId || seen.has(childId)) continue
          seen.add(childId)
          descendants.push(keyFor(childId))
          pending.push(...(children.get(childId) ?? []))
        }
        return descendants
      }
      return [...group.pages.values()].map((page) => {
        const ancestorKeys = ancestorsFor(page)
        return {
          ancestorKeys,
          depth: ancestorKeys.length,
          descendantKeys: descendantsFor(page.page_id),
          groupId,
          groupName: group.name,
          hasChildren: Boolean(children.get(page.page_id)?.length),
          key: keyFor(page.page_id),
          kind: 'page' as const,
          page,
        }
      })
    })
  }, [connection.name, pagesQuery.data?.pages])
  const rootFileResources = useMemo<FileResource[]>(() => {
    const resourcesByKey = new Map<string, FileResource>()
    for (const response of filesQuery.data?.pages ?? []) {
      for (const bucket of response.buckets) {
        const bucketName = bucket.bucket ?? undefined
        if (bucketName && bucket.files.length === 0) {
          const resource: FileResource = {
            ancestorKeys: [],
            bucket: bucketName,
            depth: 0,
            file: {
              id: '',
              name: bucketName,
              type: 'bucket',
            },
            key: `bucket:${bucketName}`,
            kind: 'file',
          }
          resourcesByKey.set(resource.key, resource)
          continue
        }
        for (const file of bucket.files) {
          const resource = fileResource(file, bucketName)
          resourcesByKey.set(resource.key, resource)
        }
      }
    }
    return [...resourcesByKey.values()]
  }, [filesQuery.data?.pages])

  const commitDriveBranch = useCallback((key: string, branch: DriveBranch) => {
    const next = new Map(driveBranchesRef.current)
    next.set(key, branch)
    driveBranchesRef.current = next
    setDriveBranches(next)
  }, [])

  const loadDriveChildren = useCallback(
    async (parent: FileResource) => {
      const cached = driveBranchesRef.current.get(parent.key)
      if (cached?.loaded) return cached.children
      const pending = driveLoadPromisesRef.current.get(parent.key)
      if (pending) return pending

      const request = (async () => {
        commitDriveBranch(parent.key, {
          children: cached?.children ?? [],
          error: false,
          loaded: false,
          loading: true,
        })
        try {
          if (!previewSource?.id) throw new Error('Source preview is not ready')
          const childrenByKey = new Map<string, FileResource>()
          const seenContinuationTokens = new Set<string>()
          let continuationToken: string | undefined
          let pageCount = 0
          do {
            pageCount += 1
            if (pageCount > MAX_SOURCE_CURSOR_PAGES)
              throw new Error('Drive folder cursor limit exceeded')
            const response =
              await consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.files.get({
                params: {
                  control_space_id: knowledgeSpaceId,
                  source_id: previewSource.id,
                },
                query: {
                  maxKeys: RESOURCE_PAGE_SIZE,
                  ...(parent.bucket ? { bucket: parent.bucket } : {}),
                  ...(!isBucket(parent) && parent.file.id ? { prefix: parent.file.id } : {}),
                  ...(continuationToken ? { continuationToken } : {}),
                },
              })
            for (const bucket of response.buckets) {
              const bucketName = bucket.bucket ?? parent.bucket
              for (const file of bucket.files) {
                const resource = fileResource(file, bucketName, parent)
                childrenByKey.set(resource.key, resource)
              }
            }
            const nextPage = response.buckets.find(
              (bucket) => bucket.is_truncated && bucket.continuation_token,
            )?.continuation_token
            if (!nextPage || seenContinuationTokens.has(nextPage)) break
            seenContinuationTokens.add(nextPage)
            continuationToken = nextPage
          } while (continuationToken)

          const children = [...childrenByKey.values()]
          commitDriveBranch(parent.key, {
            children,
            error: false,
            loaded: true,
            loading: false,
          })
          return children
        } catch (error) {
          commitDriveBranch(parent.key, {
            children: cached?.children ?? [],
            error: true,
            loaded: false,
            loading: false,
          })
          throw error
        }
      })()
      driveLoadPromisesRef.current.set(parent.key, request)
      try {
        return await request
      } finally {
        driveLoadPromisesRef.current.delete(parent.key)
      }
    },
    [commitDriveBranch, knowledgeSpaceId, previewSource?.id],
  )

  const loadDriveDescendantLeaves = useCallback(
    async (container: FileResource) => {
      const visit = async (parent: FileResource, seen: Set<string>): Promise<FileResource[]> => {
        if (seen.has(parent.key)) return []
        seen.add(parent.key)
        const children = await loadDriveChildren(parent)
        const leaves = children.filter((child) => !isDriveContainer(child))
        const nestedLeaves = await Promise.all(
          children.filter((child) => isDriveContainer(child)).map((child) => visit(child, seen)),
        )
        return [...leaves, ...nestedLeaves.flat()]
      }
      const leaves = await visit(container, new Set())
      return [...new Map(leaves.map((leaf) => [leaf.key, leaf])).values()]
    },
    [loadDriveChildren],
  )

  const allDriveResources = useMemo(() => {
    const resourcesByKey = new Map(rootFileResources.map((resource) => [resource.key, resource]))
    for (const branch of driveBranches.values()) {
      for (const resource of branch.children) resourcesByKey.set(resource.key, resource)
    }
    return [...resourcesByKey.values()]
  }, [driveBranches, rootFileResources])

  const visibleDriveResources = useMemo(() => {
    const visible: FileResource[] = []
    const append = (resource: FileResource, seen: Set<string>) => {
      if (seen.has(resource.key)) return
      seen.add(resource.key)
      visible.push(resource)
      if (!expandedDriveContainers.has(resource.key)) return
      for (const child of driveBranches.get(resource.key)?.children ?? []) append(child, seen)
    }
    const seen = new Set<string>()
    for (const resource of rootFileResources) append(resource, seen)
    return visible
  }, [driveBranches, expandedDriveContainers, rootFileResources])

  const driveDescendantLeafKeys = useMemo(() => {
    const result = new Map<string, string[]>()
    const collect = (container: FileResource, seen: Set<string>): string[] => {
      if (seen.has(container.key)) return []
      seen.add(container.key)
      const leaves: string[] = []
      for (const child of driveBranches.get(container.key)?.children ?? []) {
        if (isDriveContainer(child)) leaves.push(...collect(child, seen))
        else leaves.push(child.key)
      }
      result.set(container.key, leaves)
      return leaves
    }
    for (const resource of allDriveResources) {
      if (isDriveContainer(resource)) collect(resource, new Set())
    }
    return result
  }, [allDriveResources, driveBranches])

  const resources: SelectableResource[] = driveTransport ? allDriveResources : pageResources
  const visibleResources = useMemo(
    () =>
      driveTransport
        ? visibleDriveResources
        : pageResources.filter(
            (resource) => !resource.ancestorKeys.some((ancestorKey) => collapsed.has(ancestorKey)),
          ),
    [collapsed, driveTransport, pageResources, visibleDriveResources],
  )
  const queryPending = driveTransport ? filesQuery.isPending : pagesQuery.isPending
  const queryError = driveTransport ? filesQuery.error : pagesQuery.error
  const hasMore = driveTransport ? Boolean(filesQuery.hasNextPage) : Boolean(pagesQuery.hasNextPage)
  const loadingMore = driveTransport ? filesQuery.isFetchingNextPage : pagesQuery.isFetchingNextPage

  useEffect(() => {
    if (draft.sourceName.trim()) return
    const suggestedName =
      pageResources[0]?.groupName ??
      rootFileResources[0]?.bucket ??
      connection.name ??
      provider.displayName
    if (suggestedName) onDraftChange({ ...draft, sourceName: suggestedName })
  }, [
    connection.name,
    draft,
    onDraftChange,
    pageResources,
    provider.displayName,
    rootFileResources,
  ])

  const toggleDriveFolder = async (resource: FileResource) => {
    const descendantKeys = driveDescendantLeafKeys.get(resource.key) ?? []
    const fullySelected =
      folderSelectionIntents.has(resource.key) ||
      (descendantKeys.length > 0 && descendantKeys.every((key) => selected.has(key)))
    if (fullySelected) {
      const descendantContainers = allDriveResources
        .filter(
          (candidate) =>
            isDriveContainer(candidate) &&
            (candidate.key === resource.key || candidate.ancestorKeys.includes(resource.key)),
        )
        .map((candidate) => candidate.key)
      setFolderSelectionIntents((current) => {
        const next = new Set(current)
        for (const key of descendantContainers) next.delete(key)
        return next
      })
      updateSelected((current) => {
        const next = new Map(current)
        for (const key of descendantKeys) next.delete(key)
        return next
      })
      setSelectionLimitError(false)
      return
    }
    if (selectionAtLimit) return

    setFolderSelectionIntents((current) => new Set(current).add(resource.key))
    try {
      const leaves = await loadDriveDescendantLeaves(resource)
      const missingLeaves = leaves.filter((leaf) => !selectedRef.current.has(leaf.key))
      if (selectedRef.current.size + missingLeaves.length > MAX_SELECTION) {
        setSelectionLimitError(true)
        return
      }
      updateSelected((current) => {
        const next = new Map(current)
        for (const leaf of leaves) next.set(leaf.key, leaf)
        return next
      })
      setSelectionLimitError(false)
    } catch {
      // The branch keeps an inline retry state; leave the current selection unchanged.
    } finally {
      setFolderSelectionIntents((current) => {
        const next = new Set(current)
        next.delete(resource.key)
        return next
      })
    }
  }

  const toggle = (resource: SelectableResource) => {
    if (resource.kind === 'file' && hasDriveFolderCheckbox(resource)) {
      void toggleDriveFolder(resource)
      return
    }
    if (!isSelectableResource(resource)) return
    const removingResource = selectedRef.current.has(resource.key)
    if (resource.kind === 'file' && removingResource)
      setFolderSelectionIntents((intents) => {
        const nextIntents = new Set(intents)
        for (const ancestorKey of resource.ancestorKeys) nextIntents.delete(ancestorKey)
        return nextIntents
      })
    const resourcesToToggle =
      resource.kind === 'page'
        ? [
            resource,
            ...pageResources.filter((candidate) => resource.descendantKeys.includes(candidate.key)),
          ]
        : [resource]
    updateSelected((current) => {
      const next = new Map(current)
      const removing = resourcesToToggle.every((candidate) => next.has(candidate.key))
      if (removing) resourcesToToggle.forEach((candidate) => next.delete(candidate.key))
      else {
        for (const candidate of resourcesToToggle) {
          if (next.size >= MAX_SELECTION) break
          next.set(candidate.key, candidate)
        }
      }
      return next
    })
    setSelectionLimitError(false)
  }

  const toggleAllDriveResources = async () => {
    if (selectingAll) return
    const knownLeaves = allDriveResources.filter(isSelectableResource)
    const allKnownSelected =
      knownLeaves.length > 0 && knownLeaves.every((resource) => selected.has(resource.key))
    const allContainersLoaded = allDriveResources
      .filter(isDriveContainer)
      .every((resource) => driveBranches.get(resource.key)?.loaded)
    if (allKnownSelected && allContainersLoaded) {
      updateSelected((current) => {
        const next = new Map(current)
        for (const resource of knownLeaves) next.delete(resource.key)
        return next
      })
      setFolderSelectionIntents(new Set())
      setSelectionLimitError(false)
      return
    }
    if (selectionAtLimit) return

    setSelectingAll(true)
    const rootLeaves = rootFileResources.filter(isSelectableResource)
    const rootContainers = rootFileResources.filter(isDriveContainer)
    try {
      const nestedLeaves = await Promise.all(
        rootContainers.map((resource) => loadDriveDescendantLeaves(resource)),
      )
      const leaves = [
        ...new Map(
          [...rootLeaves, ...nestedLeaves.flat()].map((resource) => [resource.key, resource]),
        ).values(),
      ]
      const missingLeaves = leaves.filter((leaf) => !selectedRef.current.has(leaf.key))
      if (selectedRef.current.size + missingLeaves.length > MAX_SELECTION) {
        setSelectionLimitError(true)
        return
      }
      updateSelected((current) => {
        const next = new Map(current)
        for (const leaf of leaves) next.set(leaf.key, leaf)
        return next
      })
      setSelectionLimitError(false)
    } catch {
      // Failed branches stay visible and can be retried from their disclosure button.
    } finally {
      setSelectingAll(false)
    }
  }

  const toggleAll = () => {
    if (driveTransport) {
      void toggleAllDriveResources()
      return
    }
    const selectableResources = resources.filter(isSelectableResource)
    updateSelected((current) => {
      const next = new Map(current)
      const allSelected =
        selectableResources.length > 0 && selectableResources.every((item) => next.has(item.key))
      if (allSelected) selectableResources.forEach((item) => next.delete(item.key))
      else {
        for (const item of selectableResources) {
          if (next.size >= MAX_SELECTION) break
          next.set(item.key, item)
        }
      }
      return next
    })
    setSelectionLimitError(false)
  }

  const toggleExpanded = (resource: SelectableResource) => {
    if (resource.kind === 'page') {
      setCollapsed((current) => {
        const next = new Set(current)
        if (next.has(resource.key)) next.delete(resource.key)
        else next.add(resource.key)
        return next
      })
      return
    }
    const expanding = !expandedDriveContainers.has(resource.key)
    setExpandedDriveContainers((current) => {
      const next = new Set(current)
      if (next.has(resource.key)) next.delete(resource.key)
      else next.add(resource.key)
      return next
    })
    if (expanding) void loadDriveChildren(resource).catch(() => undefined)
  }

  const loadMore = () => {
    if (driveTransport) void filesQuery.fetchNextPage()
    else void pagesQuery.fetchNextPage()
  }

  const submit = async () => {
    if (
      submitting ||
      !draft.sourceName.trim() ||
      draft.sourceName.trim().length > NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH ||
      !selected.size
    )
      return
    setSubmitting(true)
    setSubmitError(false)
    const completeSubmission = async () => {
      committedRef.current = true
      onDirtyChange(false)
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.sources.get.key(),
          refetchType: 'none',
        }),
        queryClient.invalidateQueries({
          queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.documents.get.key(),
          refetchType: 'none',
        }),
      ])
      onCompleted()
    }
    try {
      const selectedResources = [...selected.values()]
      const selectedPages = selectedResources.filter(
        (resource): resource is PageResource => resource.kind === 'page',
      )
      const selectedFiles = selectedResources
        .filter((resource): resource is FileResource => resource.kind === 'file')
        .filter((resource) => !isDriveContainer(resource))
      if (!previewSource?.version) throw new Error('Source has no version')
      const finalSource = sourceFromApi(
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.patch({
          body: {
            expectedVersion: previewSource.version,
            name: draft.sourceName.trim(),
          },
          params: {
            control_space_id: knowledgeSpaceId,
            source_id: previewSource.id,
          },
        }),
      )
      if (!finalSource.version) throw new Error('Final source has no version')
      previewSourceRef.current = finalSource
      setPreviewSource(finalSource)
      const policy =
        draft.syncPolicy === 'manual'
          ? ({ enabled: false, mode: 'manual' } as const)
          : draft.syncPolicy === 'custom'
            ? ({
                customIntervalSeconds: draft.customIntervalSeconds,
                enabled: true,
                mode: 'custom',
              } as const)
            : ({ enabled: true, mode: 'interval' } as const)
      const requestFingerprint = JSON.stringify({
        policy,
        selected: [...selected.keys()].sort(),
        sourceId: finalSource.id,
      })
      if (importRequestRef.current?.fingerprint !== requestFingerprint) {
        importRequestRef.current = {
          fingerprint: requestFingerprint,
          requestId: createRequestId(),
        }
      }
      const importWorkflow = sourceWorkflowFromApi(
        await (!driveTransport
          ? consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.asyncImport.post({
              body: {
                items: selectedPages.map((resource) => ({
                  lastEditedTime: resource.page.last_edited_time ?? undefined,
                  name: resource.page.page_name,
                  pageId: resource.page.page_id,
                  providerItemId: JSON.stringify([resource.groupId, resource.page.page_id]),
                  type: resource.page.type,
                  workspaceId: resource.groupId,
                })),
                kind: 'online-document-import',
                syncPolicy: policy,
              },
              headers: { 'Idempotency-Key': importRequestRef.current.requestId },
              params: {
                control_space_id: knowledgeSpaceId,
                source_id: finalSource.id,
              },
            })
          : consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.asyncImport.post({
              body: {
                items: selectedFiles.map((resource) => ({
                  bucket: resource.bucket,
                  id: resource.file.id,
                  mimeType: resource.file.type.includes('/') ? resource.file.type : undefined,
                  name: resource.file.name,
                  providerItemId: JSON.stringify([resource.bucket ?? '', resource.file.id]),
                })),
                kind: 'online-drive-import',
                syncPolicy: policy,
              },
              headers: { 'Idempotency-Key': importRequestRef.current.requestId },
              params: {
                control_space_id: knowledgeSpaceId,
                source_id: finalSource.id,
              },
            })),
      )
      const importKind = driveTransport ? 'online-drive-import' : 'online-document-import'
      const committedSource: Source = {
        ...finalSource,
        metadata: {
          ...finalSource.metadata,
          pendingImport: {
            kind: importKind,
            syncPolicy: policy,
            workflowId: importWorkflow.id,
          },
          preview: false,
        },
        status: 'syncing',
      }
      previewSourceRef.current = committedSource
      setPreviewSource(committedSource)
      await completeSubmission()
    } catch {
      try {
        if (previewSourceRef.current) {
          const reconciledSource = sourceFromApi(
            await consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.get({
              params: {
                control_space_id: knowledgeSpaceId,
                source_id: previewSourceRef.current.id,
              },
            }),
          )
          previewSourceRef.current = reconciledSource
          setPreviewSource(reconciledSource)
          if (
            reconciledSource.metadata.preview === false &&
            (reconciledSource.status !== 'disabled' ||
              sourceHasPendingAsyncImport(reconciledSource))
          ) {
            await completeSubmission()
            return
          }
        }
      } catch {
        // Keep the last known source so the visible retry path remains available.
      }
      setSubmitError(true)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!previewSource && !previewError ? (
        <div className="flex min-h-44 items-center justify-center">
          <Loading />
        </div>
      ) : previewError ? (
        <div className="rounded-xl bg-background-section p-4">
          <p className="system-sm-semibold text-text-primary">
            {t(($) => $['newKnowledge.providerLoadFailed'])}
          </p>
          <Button className="mt-3" onClick={() => globalThis.location.reload()}>
            {t(($) => $['newKnowledge.retryProviderLoad'])}
          </Button>
        </div>
      ) : (
        <>
          <section aria-labelledby="connected-source-selection-heading">
            <div className="mb-2.5 flex h-4 items-center gap-3">
              <h3
                id="connected-source-selection-heading"
                className="min-w-0 flex-1 system-xs-semibold text-text-primary"
              >
                {driveTransport && draft.provider !== 'Google Docs'
                  ? t(($) => $['newKnowledge.selectFilesAndFolders'])
                  : draft.provider === 'Google Docs'
                    ? t(($) => $['newKnowledge.selectFoldersAndDocsToSync'])
                    : t(($) => $['newKnowledge.selectPagesToSync'])}
              </h3>
              <span role="status" className="system-xs-regular text-text-tertiary">
                {t(($) => $['newKnowledge.pagesSelected'], { count: selected.size })}
                {selectionLimitVisible && (
                  <span id={selectionLimitId} className="ml-2 text-text-destructive">
                    {t(($) => $['newKnowledge.maxPages'])}: {MAX_SELECTION}
                  </span>
                )}
              </span>
            </div>
            {queryPending ? (
              <div className="flex min-h-44 items-center justify-center rounded-xl border border-divider-regular">
                <Loading />
              </div>
            ) : queryError ? (
              <div className="rounded-xl bg-background-section p-4">
                <p className="system-sm-semibold text-text-primary">
                  {t(($) => $['newKnowledge.providerLoadFailed'])}
                </p>
                <Button
                  className="mt-3"
                  onClick={() =>
                    void (driveTransport ? filesQuery.refetch() : pagesQuery.refetch())
                  }
                >
                  {t(($) => $['newKnowledge.retryProviderLoad'])}
                </Button>
              </div>
            ) : (
              <ResourceList
                collapsed={collapsed}
                connection={connection}
                driveBranches={driveBranches}
                driveDescendantLeafKeys={driveDescendantLeafKeys}
                expandedDriveContainers={expandedDriveContainers}
                folderSelectionIntents={folderSelectionIntents}
                hasMore={hasMore}
                loadingMore={loadingMore}
                onLoadMore={loadMore}
                onToggle={toggle}
                onToggleAll={toggleAll}
                onToggleExpanded={toggleExpanded}
                providerRegion={providerRegion}
                resources={visibleResources}
                selectionAtLimit={selectionAtLimit}
                selectionLimitId={selectionLimitId}
                selectionLimitVisible={selectionLimitVisible}
                selectionPending={selectionPending}
                selectionScope={resources}
                selected={selected}
              />
            )}
          </section>
          <SourceNameField draft={draft} name="connectedSourceName" onDraftChange={onDraftChange} />
        </>
      )}
      <ConnectedSourceSyncPolicyField draft={draft} onDraftChange={onDraftChange} />
      {submitError && (
        <p role="alert" className="system-xs-regular text-text-destructive">
          {t(($) => $['newKnowledge.addSourceFailed'])}
        </p>
      )}
      <div className="mt-1 flex justify-end gap-2 border-t border-divider-subtle pt-4.75">
        <Button type="button" onClick={onExit}>
          {t(($) => $['newKnowledge.cancelAddSource'])}
        </Button>
        <Button
          variant="primary"
          loading={submitting}
          disabled={
            submitting ||
            selectionPending ||
            !previewSource ||
            !selected.size ||
            !draft.sourceName.trim() ||
            Boolean(queryError)
          }
          onClick={() => void submit()}
        >
          {t(($) => $['newKnowledge.addSource'])}
        </Button>
      </div>
    </div>
  )
}

function AppliedResourceConfiguration({
  connection,
  draft,
  knowledgeSpaceId,
  onCompleted,
  onDraftChange,
  onDirtyChange,
  onExit,
  parameters,
  parametersValid,
  parameterSchemas,
  provider,
  providerRegion,
}: {
  connection: SourceConnection
  draft: ConnectedSourceDraft
  knowledgeSpaceId: string
  onCompleted: () => void
  onDraftChange: (draft: NewKnowledgeSourceDraft) => void
  onDirtyChange: (dirty: boolean) => void
  onExit: () => void
  parameters: DatasourceParameters
  parametersValid: boolean
  parameterSchemas: DatasourceParameterSchema[]
  provider: SourceProvider
  providerRegion?: string
}) {
  const { t } = useTranslation('dataset')
  const [appliedParameters, setAppliedParameters] = useState<DatasourceParameters | undefined>(
    () => (parametersValid ? parameters : undefined),
  )
  const parametersApplied =
    appliedParameters !== undefined &&
    JSON.stringify(appliedParameters) === JSON.stringify(parameters)

  return (
    <>
      <DatasourceParameterForm
        parameters={parameters}
        schemas={parameterSchemas}
        onChange={(nextParameters) =>
          onDraftChange({
            ...draft,
            parameters: nextParameters,
          })
        }
      />
      {parametersValid && !parametersApplied && (
        <Button
          type="button"
          variant="primary"
          className="w-full"
          onClick={() => setAppliedParameters(parameters)}
        >
          {t(($) => $['newKnowledge.preview'])}
        </Button>
      )}
      {!parametersApplied && (
        <ConnectedSourceSyncPolicyField draft={draft} onDraftChange={onDraftChange} />
      )}
      {parametersApplied && appliedParameters && (
        <ResourceConfiguration
          connection={connection}
          draft={draft}
          knowledgeSpaceId={knowledgeSpaceId}
          onCompleted={onCompleted}
          onDraftChange={onDraftChange}
          onDirtyChange={onDirtyChange}
          onExit={onExit}
          parameters={appliedParameters}
          provider={provider}
          providerRegion={providerRegion}
        />
      )}
    </>
  )
}

export function ConnectedSourceSetup({
  draft,
  knowledgeSpaceId,
  onCompleted,
  onDraftChange,
  onDirtyChange,
  onExit,
}: {
  draft: ConnectedSourceDraft
  knowledgeSpaceId: string
  onCompleted: () => void
  onDraftChange: (draft: NewKnowledgeSourceDraft) => void
  onDirtyChange: (dirty: boolean) => void
  onExit: () => void
}) {
  const { t } = useTranslation('dataset')
  const queryClient = useQueryClient()
  const providersQuery = useQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.sourceProviders.get.queryOptions({
      input: { params: { control_space_id: knowledgeSpaceId } },
      context: { silent: true },
      retry: false,
      select: sourceProviderListFromApi,
    }),
  )
  const datasourcePluginsQuery = useDataSourceList(true)
  const datasourceAuthQuery = useGetDataSourceListAuth()
  const connectionsQuery = useInfiniteQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.sourceConnections.get.infiniteOptions({
      context: { silent: true },
      input: (pageParam) => ({
        params: { control_space_id: knowledgeSpaceId },
        query: {
          limit: CONNECTION_PAGE_SIZE,
          ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
        },
      }),
      getNextPageParam: (lastPage) => lastPage.next_cursor,
      initialPageParam: null as string | null,
      retry: false,
    }),
  )
  const providerOptions = useMemo(
    () => discoverSourceProviderOptions(draft.sourceType, datasourcePluginsQuery.data ?? []),
    [datasourcePluginsQuery.data, draft.sourceType],
  )
  const providerOption = sourceProviderOptionForDraft(providerOptions, draft)
  const installedProviderOption = providerOption?.installed ? providerOption : undefined
  const parameterSchemas = useMemo(
    () =>
      installedProviderOption ? datasourceParameterSchemas(installedProviderOption.datasource) : [],
    [installedProviderOption],
  )
  const parameters = useMemo(
    () => withDatasourceParameterDefaults(parameterSchemas, draft.parameters),
    [draft.parameters, parameterSchemas],
  )
  const parametersValid =
    !missingRequiredDatasourceParameters(parameterSchemas, parameters).length &&
    !invalidDatasourceParameters(parameterSchemas, parameters).length
  const provider = providerForDraft(providersQuery.data ?? [], draft, providerOption)
  const driveTransport = usesDriveTransport(draft)
  const datasourceProvider = datasourceProviderForOption(installedProviderOption)
  const datasourceAuth = datasourceAuthForProvider(
    datasourceAuthQuery.data?.result ?? [],
    datasourceProvider,
  )
  const credential = preferredCredential(datasourceAuth)
  const datasourceIdentity = useMemo(
    () =>
      datasourceProvider && credential
        ? {
            credentialId: credential.id,
            datasource: datasourceProvider.datasource.identity.name,
            pluginId: datasourceProvider.plugin.plugin_id,
            provider: datasourceProvider.plugin.provider,
          }
        : undefined,
    [credential, datasourceProvider],
  )
  const connections =
    connectionsQuery.data?.pages.flatMap((page) => sourceConnectionListFromApi(page).items) ?? []
  const remoteConnection = findSourceProviderConnection(
    connections,
    provider?.id,
    datasourceIdentity,
  )
  const [connectionOverride, setConnectionOverride] = useState<SourceConnection>()
  const [provisioningConnection, setProvisioningConnection] = useState(false)
  const [provisionError, setProvisionError] = useState(false)
  const provisioningAttemptsRef = useRef(new Set<string>())
  const connection =
    connectionOverride &&
    connectionOverride.providerId === provider?.id &&
    sourceConnectionMatchesDatasource(connectionOverride, datasourceIdentity)
      ? connectionOverride
      : remoteConnection
  const queryError =
    providersQuery.error ||
    datasourcePluginsQuery.error ||
    datasourceAuthQuery.error ||
    connectionsQuery.error ||
    connectionsQuery.isFetchNextPageError
  const loadingConnections =
    connectionsQuery.isPending ||
    (!connectionsQuery.isFetchNextPageError &&
      (connectionsQuery.hasNextPage || connectionsQuery.isFetchingNextPage))
  const {
    fetchNextPage: fetchNextConnectionPage,
    hasNextPage: hasNextConnectionPage,
    isFetchNextPageError: connectionNextPageError,
    isFetchingNextPage: fetchingNextConnectionPage,
    refetch: refetchConnections,
  } = connectionsQuery
  const { refetch: refetchDatasourceAuth } = datasourceAuthQuery
  const { refetch: refetchDatasourcePlugins } = datasourcePluginsQuery

  useEffect(() => {
    if (hasNextConnectionPage && !fetchingNextConnectionPage && !connectionNextPageError)
      void fetchNextConnectionPage()
  }, [
    connectionNextPageError,
    fetchNextConnectionPage,
    fetchingNextConnectionPage,
    hasNextConnectionPage,
  ])

  useEffect(() => {
    const refetch = () => {
      void refetchDatasourceAuth()
      void refetchDatasourcePlugins()
      void refetchConnections()
    }
    globalThis.addEventListener('focus', refetch)
    return () => globalThis.removeEventListener('focus', refetch)
  }, [refetchConnections, refetchDatasourceAuth, refetchDatasourcePlugins])

  const rememberConnection = useCallback(
    (next: SourceConnection) => {
      setConnectionOverride(next)
      void queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.sourceConnections.get.key(),
      })
    },
    [queryClient],
  )
  const provisionConnection = useCallback(
    async (force = false) => {
      if (!provider || !datasourceProvider || !credential || provisioningConnection) return
      const attemptKey = `${provider.id}:${datasourceProvider.plugin.plugin_id}:${credential.id}`
      if (!force && provisioningAttemptsRef.current.has(attemptKey)) return
      provisioningAttemptsRef.current.add(attemptKey)
      setProvisioningConnection(true)
      setProvisionError(false)
      try {
        rememberConnection(
          sourceConnectionFromApi(
            await consoleClient.knowledgeFs.spaces.byControlSpaceId.sourceConnections.post({
              body: {
                authKind: 'endpoint',
                configuration: {
                  credentialId: credential.id,
                  datasource: datasourceProvider.datasource.identity.name,
                  pluginId: datasourceProvider.plugin.plugin_id,
                  provider: datasourceProvider.plugin.provider,
                  providerKind: driveTransport ? 'online-drive' : 'online-document',
                },
                credentials: {},
                name: credential.name || draft.provider,
                providerId: provider.id,
              },
              params: { control_space_id: knowledgeSpaceId },
            }),
          ),
        )
      } catch {
        const refreshed = await refetchConnections()
        const refreshedConnections =
          refreshed.data?.pages.flatMap((page) => sourceConnectionListFromApi(page).items) ?? []
        const reconciled = findSourceProviderConnection(
          refreshedConnections,
          provider.id,
          datasourceIdentity,
        )
        if (reconciled && ['active', 'provisioning'].includes(reconciled.status))
          rememberConnection(reconciled)
        else setProvisionError(true)
      } finally {
        setProvisioningConnection(false)
      }
    },
    [
      credential,
      datasourceIdentity,
      datasourceProvider,
      driveTransport,
      draft.provider,
      knowledgeSpaceId,
      provider,
      provisioningConnection,
      refetchConnections,
      rememberConnection,
    ],
  )
  useEffect(() => {
    if (
      !connection &&
      credential &&
      provider?.available &&
      !providersQuery.isPending &&
      !datasourcePluginsQuery.isPending &&
      !datasourceAuthQuery.isPending &&
      !loadingConnections
    )
      void provisionConnection()
  }, [
    connection,
    credential,
    datasourceAuthQuery.isPending,
    datasourcePluginsQuery.isPending,
    loadingConnections,
    provider?.available,
    providersQuery.isPending,
    provisionConnection,
  ])
  const selectProvider = (providerKey: string) => {
    const nextProvider = providerOptions.find((option) => option.key === providerKey)
    if (!nextProvider) return
    setConnectionOverride(undefined)
    setProvisionError(false)
    if (draft.sourceType === 'onlineDocuments') {
      onDraftChange({
        ...draft,
        parameters: nextProvider.installed
          ? datasourceParameterDefaults(datasourceParameterSchemas(nextProvider.datasource))
          : {},
        provider: nextProvider.label,
        providerKey: nextProvider.key,
        sourceName: '',
      })
      return
    }
    onDraftChange({
      ...draft,
      parameters: nextProvider.installed
        ? datasourceParameterDefaults(datasourceParameterSchemas(nextProvider.datasource))
        : {},
      provider: nextProvider.label,
      providerKey: nextProvider.key,
      sourceName: '',
    })
  }
  return (
    <div className="flex flex-col gap-4">
      <SourceProviderSelector
        options={providerOptions}
        providerKey={providerOption?.key ?? ''}
        onChange={selectProvider}
      />
      {providersQuery.isPending ||
      datasourcePluginsQuery.isPending ||
      datasourceAuthQuery.isPending ||
      loadingConnections ? (
        <div className="flex min-h-44 items-center justify-center">
          <Loading />
        </div>
      ) : queryError ? (
        <div className="rounded-xl bg-background-section p-4">
          <p className="system-sm-semibold text-text-primary">
            {t(($) => $['newKnowledge.providerLoadFailed'])}
          </p>
          <Button
            className="mt-3"
            onClick={() =>
              void Promise.all([
                providersQuery.refetch(),
                datasourcePluginsQuery.refetch(),
                datasourceAuthQuery.refetch(),
                connectionsQuery.refetch(),
              ])
            }
          >
            {t(($) => $['newKnowledge.retryProviderLoad'])}
          </Button>
        </div>
      ) : providerOption && !providerOption.installed ? (
        <SourceProviderNotInstalledCard
          icon={<SourceProviderIcon fallbackIcon={providerOption.fallbackIcon} />}
          provider={providerOption.label}
          onInstall={() =>
            globalThis.open(
              providerIntegrationPath(providerOption),
              '_blank',
              'noopener,noreferrer',
            )
          }
        />
      ) : !installedProviderOption || !provider ? (
        <div className="rounded-xl bg-background-section p-4">
          <p className="system-sm-semibold text-text-primary">{draft.provider}</p>
          <p className="mt-1 system-xs-regular text-text-tertiary">
            {t(($) => $['newKnowledge.providerUnavailable'])}
          </p>
        </div>
      ) : !provider.available ? (
        <div className="rounded-xl bg-background-section p-4">
          <p className="system-sm-semibold text-text-primary">{provider.displayName}</p>
          <p className="mt-1 system-xs-regular text-text-tertiary">
            {provider.unavailableReason ?? t(($) => $['newKnowledge.providerUnavailable'])}
          </p>
        </div>
      ) : connection?.status === 'active' ? (
        <AppliedResourceConfiguration
          key={`${provider.id}:${connection.id}`}
          connection={connection}
          draft={draft}
          knowledgeSpaceId={knowledgeSpaceId}
          onCompleted={onCompleted}
          onDraftChange={onDraftChange}
          onDirtyChange={onDirtyChange}
          onExit={onExit}
          parameters={parameters}
          parametersValid={parametersValid}
          parameterSchemas={parameterSchemas}
          provider={provider}
          providerRegion={draft.provider === 'Amazon S3' ? credentialRegion(credential) : undefined}
        />
      ) : connection?.status === 'provisioning' ? (
        <div className="rounded-xl bg-background-section p-4">
          <p className="system-sm-semibold text-text-primary">
            {t(($) => $['newKnowledge.connectionProvisioning'], {
              provider: provider.displayName,
            })}
          </p>
          <Button className="mt-3" onClick={() => void connectionsQuery.refetch()}>
            {t(($) => $['newKnowledge.refreshConnectionStatus'])}
          </Button>
        </div>
      ) : connection ? (
        <div className="rounded-xl bg-background-section p-4">
          <p className="system-sm-semibold text-text-primary">
            {t(($) => $['newKnowledge.connectionNeedsAttention'], {
              provider: provider.displayName,
            })}
          </p>
          <p className="mt-1 system-xs-regular text-text-tertiary">
            {t(($) => $['newKnowledge.providerCredentialRequiredDescription'], {
              provider: draft.provider,
            })}
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              variant="primary"
              onClick={() =>
                globalThis.open(
                  providerIntegrationPath(installedProviderOption),
                  '_blank',
                  'noopener,noreferrer',
                )
              }
            >
              {t(($) => $['newKnowledge.connectProvider'], { provider: draft.provider })}
            </Button>
            <Button loading={provisioningConnection} onClick={() => void provisionConnection(true)}>
              {t(($) => $['newKnowledge.retryProviderLoad'])}
            </Button>
          </div>
        </div>
      ) : provisioningConnection ? (
        <div className="flex min-h-44 items-center justify-center rounded-xl bg-background-section">
          <div className="text-center">
            <Loading />
            <p className="mt-2 system-xs-regular text-text-tertiary">
              {t(($) => $['newKnowledge.connectingProvider'])}
            </p>
          </div>
        </div>
      ) : provisionError ? (
        <div className="rounded-xl bg-background-section p-4">
          <p role="alert" className="system-sm-semibold text-text-primary">
            {t(($) => $['newKnowledge.connectionFailed'], { provider: draft.provider })}
          </p>
          <Button
            className="mt-3"
            onClick={() => {
              if (!provider || !datasourceProvider || !credential) return
              provisioningAttemptsRef.current.delete(
                `${provider.id}:${datasourceProvider.plugin.plugin_id}:${credential.id}`,
              )
              void provisionConnection(true)
            }}
          >
            {t(($) => $['newKnowledge.retryProviderLoad'])}
          </Button>
        </div>
      ) : (
        <SourceProviderCredentialRequiredCard
          icon={
            <SourceProviderIcon
              fallbackIcon={installedProviderOption.fallbackIcon}
              icon={datasourceProviderIcon(datasourceProvider)}
            />
          }
          provider={installedProviderOption.label}
          onConnect={() =>
            globalThis.open(
              providerIntegrationPath(installedProviderOption),
              '_blank',
              'noopener,noreferrer',
            )
          }
        />
      )}
      {connection?.status !== 'active' && (
        <ConnectedSourceSyncPolicyField draft={draft} onDraftChange={onDraftChange} />
      )}
      {!connection && (
        <div className="mt-1 flex justify-between gap-2 border-t border-divider-subtle pt-4.75">
          <Button type="button" onClick={onExit}>
            {t(($) => $['newKnowledge.cancelAddSource'])}
          </Button>
          <Button variant="primary" disabled>
            {t(($) => $['newKnowledge.addSource'])}
          </Button>
        </div>
      )}
    </div>
  )
}
