'use client'

import type { StatusDotStatus } from '@langgenius/dify-ui/status-dot'
import type { Source, SourceSyncPolicy } from './source-models'
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
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { SearchInput } from '@/app/components/base/search-input'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import Link from '@/next/link'
import { consoleClient, consoleQuery } from '@/service/client'
import { hasPermission } from '@/utils/permission'
import { KnowledgeModelSetupDialog } from './components/knowledge-model-setup-dialog'
import { newKnowledgeAddSourcePath } from './routes'
import {
  sourceFromApi,
  sourceStatusWithSyncWorkflow,
  sourceWorkflowFromApi,
  sourceWorkflowStatus,
} from './source-models'
import { normalizeSourceProviderName, sourceProviderPresentation } from './source-provider-options'
import { SourceProviderIcon } from './source-setup-fields'
import { useKnowledgeModelSetupGuard } from './use-knowledge-model-setup-guard'

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

function metadataRecord(metadata: Source['metadata'], key: string) {
  const value = metadata[key]
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function sourceProviderType(source: Source, providerKind?: string) {
  if (source.type === 'web' || providerKind === 'website') return 'websiteCrawl' as const
  if (providerKind === 'online-document') return 'onlineDocuments' as const
  if (providerKind === 'online-drive') return 'onlineDrive' as const
  return undefined
}

function sourceProviderDetails(source: Source) {
  const providerKind = metadataString(source.metadata, 'providerKind')
  const providerType = sourceProviderType(source, providerKind)
  const explicitName = metadataString(source.metadata, 'providerName')
  if (explicitName) {
    const presentation = sourceProviderPresentation(explicitName, providerType)
    return {
      iconClass: presentation?.fallbackIcon,
      name: presentation?.label ?? explicitName,
    }
  }

  const providerId = metadataString(source.metadata, 'providerId')
  if (!providerId) return {}
  const presentation = sourceProviderPresentation(providerId, providerType)
  if (presentation) return { iconClass: presentation.fallbackIcon, name: presentation.label }
  if (normalizeSourceProviderName(providerId).includes('fakecrawler'))
    return { name: 'FakeCrawler' }
  return {}
}

function sourceLastSyncAt(source: Source) {
  const syncMetadata = metadataRecord(source.metadata, 'sync')
  return (
    source.lastSyncedAt ??
    metadataString(source.metadata, 'lastSyncedAt') ??
    (syncMetadata ? metadataString(syncMetadata, 'lastRunAt') : undefined)
  )
}

function sourceSyncPolicyTranslationKey(policy: SourceSyncPolicy) {
  if (!policy.enabled || policy.mode === 'manual') return 'newKnowledge.syncPolicyManual' as const
  if (policy.mode === 'provider') return 'newKnowledge.syncPolicyProvider' as const
  if (policy.mode === 'interval') return 'newKnowledge.syncPolicyDaily' as const
  return 'newKnowledge.syncPolicyCustom' as const
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

function sourceWorkflowIsActive(workflow?: Source['syncWorkflow']) {
  return workflow !== undefined && sourceWorkflowStatus(workflow.state) === 'syncing'
}

function latestSourceWorkflow(
  sourceWorkflow?: Source['syncWorkflow'],
  sourceOverrideWorkflow?: Source['syncWorkflow'],
) {
  if (!sourceWorkflow || !sourceOverrideWorkflow) return sourceWorkflow ?? sourceOverrideWorkflow
  if (sourceWorkflow.id === sourceOverrideWorkflow.id) return sourceWorkflow
  const sourceWorkflowIsRunning = sourceWorkflowIsActive(sourceWorkflow)
  const sourceOverrideWorkflowIsRunning = sourceWorkflowIsActive(sourceOverrideWorkflow)
  // The server snapshot ranks active runs first, so an active server run remains authoritative
  // even when it is an older run being retried. A local active override still has to be newer
  // than a terminal server run, otherwise it could remain stuck after a later run completes.
  if (sourceWorkflowIsRunning && !sourceOverrideWorkflowIsRunning) return sourceWorkflow
  const createdAtComparison = sourceWorkflow.createdAt.localeCompare(
    sourceOverrideWorkflow.createdAt,
  )
  if (createdAtComparison !== 0)
    return createdAtComparison > 0 ? sourceWorkflow : sourceOverrideWorkflow
  const updatedAtComparison = sourceWorkflow.updatedAt.localeCompare(
    sourceOverrideWorkflow.updatedAt,
  )
  if (updatedAtComparison !== 0)
    return updatedAtComparison > 0 ? sourceWorkflow : sourceOverrideWorkflow
  return sourceWorkflow.id > sourceOverrideWorkflow.id ? sourceWorkflow : sourceOverrideWorkflow
}

function getCurrentSource(source: Source, sourceOverride?: Source) {
  if (!sourceOverride || sourceOverride.id !== source.id) return source
  const sourceVersion = source.version ?? -1
  const overrideVersion = sourceOverride.version ?? -1
  if (sourceVersion > overrideVersion) return source
  const overrideHasNewerSource =
    sourceVersion < overrideVersion || source.updatedAt < sourceOverride.updatedAt
  const sourceHasNewerSource =
    sourceVersion === overrideVersion && source.updatedAt > sourceOverride.updatedAt
  if (sourceHasNewerSource) return source
  const syncWorkflow = overrideHasNewerSource
    ? sourceOverride.syncWorkflow
    : latestSourceWorkflow(source.syncWorkflow, sourceOverride.syncWorkflow)
  if (
    !overrideHasNewerSource &&
    source.syncWorkflow &&
    source.syncWorkflow.id !== sourceOverride.syncWorkflow?.id &&
    syncWorkflow === source.syncWorkflow
  )
    return source
  return {
    ...sourceOverride,
    lastSyncedAt: source.lastSyncedAt ?? sourceOverride.lastSyncedAt,
    status: sourceStatusWithSyncWorkflow(sourceOverride.status, syncWorkflow),
    syncWorkflow,
    syncPolicy: source.syncPolicy ?? sourceOverride.syncPolicy,
  }
}

function sourceNeedsPolling(source: Source) {
  return source.status === 'syncing' || sourceWorkflowIsActive(source.syncWorkflow)
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
                  aria-label={t(($) => $['newKnowledge.openSource'])}
                  href={sourceUri}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
              className="mb-px h-7 gap-2 px-2 system-sm-medium"
            >
              <span aria-hidden className="i-ri-external-link-line size-4" />
              {t(($) => $['newKnowledge.openSource'])}
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
  onRemoved: () => void
  onSourceChange: (source: Source) => void
  source: Source
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const queryClient = useQueryClient()
  const [pendingAction, setPendingAction] = useState<SourceAction>()
  const syncWorkflow = source.syncWorkflow

  const provider = sourceProviderDetails(source)
  const providerName = provider.name
  const providerKind = metadataString(source.metadata, 'providerKind')
  const sourceSyncPolicy = source.syncPolicy
  const syncPolicy = sourceSyncPolicy
    ? t(($) => $[sourceSyncPolicyTranslationKey(sourceSyncPolicy)])
    : metadataString(source.metadata, 'syncPolicy')
  const lastSyncAt = sourceLastSyncAt(source)
  const lastSyncTimestamp = lastSyncAt ? Date.parse(lastSyncAt) : Number.NaN
  const lastSync = Number.isNaN(lastSyncTimestamp)
    ? undefined
    : formatTimeFromNow(lastSyncTimestamp)
  const typeLabel =
    source.type === 'connector' &&
    (providerKind === 'online-document' ||
      providerName === 'Notion' ||
      providerName === 'Google Docs' ||
      providerName === 'Confluence')
      ? t(($) => $['newKnowledge.onlineDocuments'])
      : source.type === 'connector' &&
          (providerKind === 'online-drive' ||
            providerName === 'Google Drive' ||
            providerName === 'OneDrive' ||
            providerName === 'Amazon S3')
        ? t(($) => $['newKnowledge.onlineDrive'])
        : t(($) => $[`newKnowledge.sourceType.${source.type}`])
  const sourceIcon =
    provider.iconClass ?? (source.type === 'web' ? 'i-ri-global-line' : 'i-ri-links-line')

  const runAction = async <Result,>(
    action: SourceAction,
    mutation: () => Promise<Result>,
    onAccepted?: (result: Result) => void,
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
        await queryClient.invalidateQueries(
          {
            queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.sources.get.key(),
          },
          {
            throwOnError: true,
          },
        )
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
        onSourceChange({
          ...source,
          syncWorkflow: run,
          status: sourceStatusWithSyncWorkflow(source.status, run),
        })
      },
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
      (updatedSource) => {
        const syncWorkflow =
          updatedSource.syncWorkflow ??
          (sourceWorkflowIsActive(source.syncWorkflow) ? source.syncWorkflow : undefined)
        onSourceChange({
          ...updatedSource,
          lastSyncedAt: updatedSource.lastSyncedAt ?? source.lastSyncedAt,
          status: sourceStatusWithSyncWorkflow(updatedSource.status, syncWorkflow),
          syncWorkflow,
          syncPolicy: updatedSource.syncPolicy ?? source.syncPolicy,
        })
      },
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
        'h-[50px] border-t border-divider-subtle',
        source.status === 'disabled' && '[&>td:not(:first-child)]:opacity-60',
      )}
    >
      <td className="py-2 pr-3 whitespace-nowrap">
        <Checkbox aria-label={source.name} checked={checked} onCheckedChange={onCheckedChange} />
      </td>
      <td className="min-w-0 py-2 pr-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <SourceProviderIcon fallbackIcon={sourceIcon} />
          <div className="min-w-0">
            <p className="truncate system-xs-medium text-text-primary">{source.name}</p>
          </div>
        </div>
      </td>
      <td className="py-2 pr-3 whitespace-nowrap">
        <div className="flex flex-col gap-0.5">
          <p className="system-xs-regular text-text-primary">{providerName ?? typeLabel}</p>
          {providerName && <p className="system-xs-regular text-text-tertiary">{typeLabel}</p>}
        </div>
      </td>
      <td className="py-2 pr-3 whitespace-nowrap">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 system-xs-medium text-text-primary',
            source.status === 'syncing' && 'text-text-accent',
          )}
        >
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
      <td className="py-2 pr-3 system-xs-regular whitespace-nowrap text-text-secondary">
        {syncPolicy ?? '—'}
      </td>
      <td
        className={cn(
          'py-2 pr-3 system-xs-regular whitespace-nowrap',
          source.status === 'error' ? 'text-text-destructive' : 'text-text-secondary',
        )}
      >
        {source.status === 'syncing' && syncWorkflow ? (
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
        ) : source.status === 'error' ? (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="i-ri-error-warning-fill size-3.5" />
            {syncWorkflow?.lastErrorCode ?? t(($) => $['newKnowledge.sourceSyncFailed'])}
          </span>
        ) : (
          (lastSync ?? '—')
        )}
      </td>
      <td className="py-2 text-right whitespace-nowrap">
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
              sourceNeedsPolling(
                getCurrentSource(sourceFromApi(source), sourceOverrides[source.id]),
              ),
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
          <div className="mt-8.5 flex flex-col gap-2 sm:flex-row">
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
          <div className="mt-2.5 overflow-x-auto pt-3">
            <table className="w-full table-auto border-collapse text-left">
              <thead className="system-2xs-medium text-text-tertiary uppercase">
                <tr className="h-9">
                  <th className="py-2.5 pr-3 whitespace-nowrap">
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
                    className="py-2.5 font-medium"
                  >
                    <Button
                      variant="ghost"
                      size="small"
                      onClick={() =>
                        setSort((current) => (current === 'name-asc' ? 'name-desc' : 'name-asc'))
                      }
                      className="h-auto gap-1 rounded px-0 focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
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
                  <th className="py-2.5 font-medium whitespace-nowrap">
                    {t(($) => $['metadata.createMetadata.type'])}
                  </th>
                  <th className="py-2.5 font-medium whitespace-nowrap">
                    {t(($) => $['newKnowledge.statusColumn'])}
                  </th>
                  <th className="py-2.5 font-medium whitespace-nowrap">
                    {t(($) => $['newKnowledge.syncPolicyColumn'])}
                  </th>
                  <th className="py-2.5 font-medium whitespace-nowrap">
                    {t(($) => $['newKnowledge.lastSyncColumn'])}
                  </th>
                  <th
                    className="whitespace-nowrap"
                    aria-label={t(($) => $['newKnowledge.actionsColumn'])}
                  />
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
