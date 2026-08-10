'use client'

import type {
  KnowledgeFsInitialSourcePreviewDocumentResponse,
  KnowledgeFsInitialSourcePreviewFileResponse,
  KnowledgeFsSpaceCreatePayload,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type {
  NewKnowledgeOnlineDocumentsSourceDraft,
  NewKnowledgeOnlineDriveSourceDraft,
  NewKnowledgeSourceDraft,
} from './routes'
import type { InstalledSourceProviderOption } from './source-provider-options'
import type { DataSourceCredential } from '@/app/components/header/account-setting/data-source-page-new/types'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { consoleClient } from '@/service/client'
import { SourceNameField, SourceSyncPolicyField } from './source-setup-fields'

type ConnectedDraft = NewKnowledgeOnlineDocumentsSourceDraft | NewKnowledgeOnlineDriveSourceDraft
type InitialSource = NonNullable<KnowledgeFsSpaceCreatePayload['initial_source']>
type PreviewDocument = KnowledgeFsInitialSourcePreviewDocumentResponse
type PreviewFile = KnowledgeFsInitialSourcePreviewFileResponse
type PreviewResource =
  | {
      depth: number
      document: PreviewDocument
      key: string
      kind: 'document'
      parentKey?: string
    }
  | { depth: number; file: PreviewFile; key: string; kind: 'file'; parentKey?: string }
type NextPageRequest = {
  bucket?: string
  depth: number
  nextPage: Record<string, unknown>
  parentKey?: string
  prefix?: string
}

function isDriveContainer(file: PreviewFile) {
  return /bucket|directory|folder|workspace/i.test(file.type)
}

function resourceName(resource: PreviewResource) {
  return resource.kind === 'document' ? resource.document.name : resource.file.name
}

function resourceIcon(resource: PreviewResource) {
  if (resource.kind === 'file' && isDriveContainer(resource.file))
    return 'i-ri-folder-3-fill text-text-warning'
  return resource.kind === 'document'
    ? 'i-ri-file-text-line text-text-tertiary'
    : 'i-ri-file-3-line text-text-tertiary'
}

export function CreateConnectedSourceSetup({
  credential,
  disabled,
  draft,
  providerOption,
  onDraftChange,
  onInitialSourceChange,
}: {
  credential: DataSourceCredential
  disabled: boolean
  draft: ConnectedDraft
  providerOption: InstalledSourceProviderOption
  onDraftChange: (draft: NewKnowledgeSourceDraft) => void
  onInitialSourceChange: (source?: InitialSource) => void
}) {
  const { t } = useTranslation('dataset')
  const [resources, setResources] = useState<PreviewResource[]>([])
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(false)
  const [previewed, setPreviewed] = useState(false)
  const [nextPageRequest, setNextPageRequest] = useState<NextPageRequest | null>()
  const selectableResources = useMemo(
    () =>
      resources.filter(
        (resource) => resource.kind === 'document' || !isDriveContainer(resource.file),
      ),
    [resources],
  )
  const visibleResources = useMemo(() => {
    const byKey = new Map(resources.map((resource) => [resource.key, resource]))
    return resources.filter((resource) => {
      let parentKey = resource.parentKey
      while (parentKey) {
        if (!expanded.has(parentKey)) return false
        parentKey = byKey.get(parentKey)?.parentKey
      }
      return true
    })
  }, [expanded, resources])

  useEffect(() => {
    const selectedResources = selectableResources.filter((resource) => selected.has(resource.key))
    const name = draft.sourceName.trim()
    if (!name || !selectedResources.length) {
      onInitialSourceChange(undefined)
      return
    }
    const binding = {
      credentialId: credential.id,
      datasource: providerOption.datasource.identity.name,
      pluginId: providerOption.plugin.plugin_id,
      provider: providerOption.plugin.provider,
    }
    if (draft.sourceType === 'onlineDocuments') {
      onInitialSourceChange({
        ...binding,
        kind: 'online_document',
        name,
        selection: selectedResources.flatMap((resource) =>
          resource.kind === 'document'
            ? [
                {
                  lastEditedTime: resource.document.last_edited_time ?? undefined,
                  name: resource.document.name,
                  pageId: resource.document.page_id,
                  providerItemId: resource.document.provider_item_id,
                  type: resource.document.type,
                  workspaceId: resource.document.workspace_id,
                },
              ]
            : [],
        ),
        sync_policy: draft.syncPolicy,
      })
      return
    }
    onInitialSourceChange({
      ...binding,
      kind: 'online_drive',
      name,
      selection: selectedResources.flatMap((resource) =>
        resource.kind === 'file'
          ? [
              {
                bucket: resource.file.bucket ?? undefined,
                id: resource.file.id,
                mimeType: resource.file.mime_type ?? undefined,
                name: resource.file.name,
                providerItemId: resource.file.provider_item_id,
              },
            ]
          : [],
      ),
      sync_policy: draft.syncPolicy,
    })
  }, [
    credential.id,
    draft,
    onInitialSourceChange,
    providerOption.datasource.identity.name,
    providerOption.plugin.plugin_id,
    providerOption.plugin.provider,
    selectableResources,
    selected,
  ])

  const requestPreview = useCallback(
    async ({
      append = false,
      bucket,
      depth = 0,
      nextPage,
      parentKey,
      prefix,
    }: {
      append?: boolean
      bucket?: string
      depth?: number
      nextPage?: Record<string, unknown>
      parentKey?: string
      prefix?: string
    } = {}) => {
      append ? setLoadingMore(true) : setLoading(true)
      setError(false)
      try {
        const response = await consoleClient.knowledgeFs.sourceProviderPreview.post({
          body: {
            credentialId: credential.id,
            datasource: providerOption.datasource.identity.name,
            kind: draft.sourceType === 'onlineDocuments' ? 'online_document' : 'online_drive',
            parameters: {
              ...(bucket ? { bucket } : {}),
              ...(prefix ? { prefix } : {}),
              ...(nextPage ? { next_page_parameters: nextPage } : {}),
            },
            pluginId: providerOption.plugin.plugin_id,
            provider: providerOption.plugin.provider,
          },
        })
        const nextResources: PreviewResource[] =
          draft.sourceType === 'onlineDocuments'
            ? (response.documents ?? []).map((document) => ({
                depth,
                document,
                key: `document:${document.provider_item_id}`,
                kind: 'document' as const,
                parentKey,
              }))
            : (response.files ?? []).map((file) => ({
                depth,
                file,
                key: `file:${file.provider_item_id}`,
                kind: 'file' as const,
                parentKey,
              }))
        setResources((current) => {
          const next = new Map((append ? current : []).map((resource) => [resource.key, resource]))
          for (const resource of nextResources) next.set(resource.key, resource)
          return [...next.values()]
        })
        if (parentKey) setExpanded((current) => new Set(current).add(parentKey))
        setNextPageRequest(
          response.next_page_parameters
            ? {
                bucket,
                depth,
                nextPage: response.next_page_parameters,
                parentKey,
                prefix,
              }
            : null,
        )
        setPreviewed(true)
      } catch {
        setError(true)
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [credential.id, draft.sourceType, providerOption],
  )

  const toggle = (key: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const toggleAll = () => {
    setSelected((current) => {
      const next = new Set(current)
      const allSelected =
        selectableResources.length > 0 &&
        selectableResources.every((resource) => current.has(resource.key))
      for (const resource of selectableResources) {
        if (allSelected) next.delete(resource.key)
        else next.add(resource.key)
      }
      return next
    })
  }
  const expandContainer = (resource: Extract<PreviewResource, { kind: 'file' }>) => {
    if (expanded.has(resource.key)) {
      setExpanded((current) => {
        const next = new Set(current)
        next.delete(resource.key)
        return next
      })
      return
    }
    void requestPreview({
      append: true,
      bucket: resource.file.bucket ?? undefined,
      depth: resource.depth + 1,
      parentKey: resource.key,
      prefix: resource.file.id || undefined,
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SourceNameField
          disabled={disabled}
          draft={draft}
          preventSubmitOnEnter
          size="medium"
          onDraftChange={onDraftChange}
        />
        <SourceSyncPolicyField
          availablePolicies={draft.provider === 'Amazon S3' ? ['daily', 'manual'] : undefined}
          disabled={disabled}
          draft={draft}
          size="medium"
          onDraftChange={onDraftChange}
        />
      </div>
      {!previewed && (
        <Button
          type="button"
          variant="primary"
          className="w-full"
          loading={loading}
          disabled={disabled || loading}
          onClick={() => void requestPreview()}
        >
          {t(($) => $['newKnowledge.preview'])}
        </Button>
      )}
      {loading && (
        <div className="flex min-h-40 items-center justify-center rounded-lg border border-divider-subtle">
          <Loading />
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-lg bg-background-section p-4">
          <p className="system-sm-semibold text-text-primary">
            {t(($) => $['newKnowledge.providerLoadFailed'])}
          </p>
          <Button className="mt-3" onClick={() => void requestPreview()}>
            {t(($) => $['newKnowledge.retryProviderLoad'])}
          </Button>
        </div>
      )}
      {previewed && !loading && (
        <section className="overflow-hidden rounded-lg border border-divider-subtle bg-background-default">
          <div className="flex items-center gap-2 border-b border-divider-subtle px-3 py-2">
            <Checkbox
              aria-label={t(($) => $['newKnowledge.selectAll'])}
              checked={
                selectableResources.length > 0 &&
                selectableResources.every((resource) => selected.has(resource.key))
              }
              disabled={disabled || !selectableResources.length}
              onCheckedChange={toggleAll}
            />
            <span className="system-xs-medium text-text-secondary">
              {draft.sourceType === 'onlineDocuments'
                ? t(($) => $['newKnowledge.selectPagesToSync'])
                : t(($) => $['newKnowledge.selectFilesAndFolders'])}
            </span>
            <span className="ml-auto system-xs-regular text-text-tertiary">
              {t(($) => $['newKnowledge.pagesSelected'], { count: selected.size })}
            </span>
          </div>
          <ul className="max-h-64 overflow-y-auto p-1.5">
            {visibleResources.map((resource) => {
              const container = resource.kind === 'file' && isDriveContainer(resource.file)
              return (
                <li
                  key={resource.key}
                  className="flex min-h-8 items-center gap-2 rounded-md px-2 hover:bg-state-base-hover"
                  style={{ paddingLeft: `${8 + resource.depth * 20}px` }}
                >
                  {container ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="small"
                      className="size-5 px-0"
                      aria-label={resourceName(resource)}
                      disabled={disabled || loadingMore}
                      onClick={() => expandContainer(resource)}
                    >
                      <span
                        aria-hidden
                        className={`i-ri-arrow-right-s-line size-4 transition-transform ${
                          expanded.has(resource.key) ? 'rotate-90' : ''
                        }`}
                      />
                    </Button>
                  ) : (
                    <Checkbox
                      aria-label={resourceName(resource)}
                      checked={selected.has(resource.key)}
                      disabled={disabled}
                      onCheckedChange={() => toggle(resource.key)}
                    />
                  )}
                  <span aria-hidden className={`${resourceIcon(resource)} size-4 shrink-0`} />
                  <span className="min-w-0 flex-1 truncate system-xs-regular text-text-primary">
                    {resourceName(resource)}
                  </span>
                </li>
              )
            })}
          </ul>
          {nextPageRequest && (
            <div className="border-t border-divider-subtle px-3 py-2 text-center">
              <Button
                type="button"
                size="small"
                variant="ghost"
                loading={loadingMore}
                onClick={() => void requestPreview({ append: true, ...nextPageRequest })}
              >
                {t(($) => $['newKnowledge.loadMore'])}
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
