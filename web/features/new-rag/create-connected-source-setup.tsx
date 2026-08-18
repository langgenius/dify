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
import { DatasourceParameterForm } from './datasource-parameter-form'
import {
  datasourceParameterSchemas,
  invalidDatasourceParameters,
  missingRequiredDatasourceParameters,
  withDatasourceParameterDefaults,
} from './datasource-parameter-model'
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

const MAX_SELECTION = 200
const ROOT_PAGE_SCOPE = 'root'
const SELECTION_LIMIT_ID = 'create-connected-source-selection-limit'

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
  const [nextPageRequests, setNextPageRequests] = useState<Map<string, NextPageRequest>>(
    () => new Map(),
  )
  const driveTransport = providerOption.providerType === 'online_drive'
  const parameterSchemas = useMemo(
    () => datasourceParameterSchemas(providerOption.datasource),
    [providerOption.datasource],
  )
  const parameters = useMemo(
    () => withDatasourceParameterDefaults(parameterSchemas, draft.parameters),
    [draft.parameters, parameterSchemas],
  )
  const parametersValid =
    !missingRequiredDatasourceParameters(parameterSchemas, parameters).length &&
    !invalidDatasourceParameters(parameterSchemas, parameters).length
  const selectionAtLimit = selected.size >= MAX_SELECTION
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
      providerDisplayName: providerOption.label,
      parameters,
    }
    if (!driveTransport) {
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
        ...(draft.syncPolicy === 'custom' && draft.customIntervalSeconds
          ? { custom_interval_seconds: draft.customIntervalSeconds }
          : {}),
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
      ...(draft.syncPolicy === 'custom' && draft.customIntervalSeconds
        ? { custom_interval_seconds: draft.customIntervalSeconds }
        : {}),
      sync_policy: draft.syncPolicy,
    })
  }, [
    credential.id,
    draft,
    driveTransport,
    onInitialSourceChange,
    providerOption.datasource.identity.name,
    providerOption.label,
    providerOption.plugin.plugin_id,
    providerOption.plugin.provider,
    parameters,
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
      if (!parametersValid) return
      append ? setLoadingMore(true) : setLoading(true)
      setError(false)
      try {
        const response = await consoleClient.knowledgeFs.sourceProviderPreview.post({
          body: {
            credentialId: credential.id,
            datasource: providerOption.datasource.identity.name,
            kind: driveTransport ? 'online_drive' : 'online_document',
            parameters: {
              ...parameters,
              ...(bucket ? { bucket } : {}),
              ...(prefix ? { prefix } : {}),
              ...(nextPage ? { next_page_parameters: nextPage } : {}),
            },
            pluginId: providerOption.plugin.plugin_id,
            provider: providerOption.plugin.provider,
          },
        })
        const nextResources: PreviewResource[] = driveTransport
          ? (response.files ?? []).map((file) => ({
              depth,
              file,
              key: `file:${file.provider_item_id}`,
              kind: 'file' as const,
              parentKey,
            }))
          : (response.documents ?? []).map((document) => ({
              depth,
              document,
              key: `document:${document.provider_item_id}`,
              kind: 'document' as const,
              parentKey,
            }))
        setResources((current) => {
          const next = new Map((append ? current : []).map((resource) => [resource.key, resource]))
          for (const resource of nextResources) next.set(resource.key, resource)
          return [...next.values()]
        })
        if (parentKey) setExpanded((current) => new Set(current).add(parentKey))
        setNextPageRequests((current) => {
          const next = append ? new Map(current) : new Map<string, NextPageRequest>()
          const scope = parentKey ?? ROOT_PAGE_SCOPE
          if (response.next_page_parameters) {
            next.set(scope, {
              bucket,
              depth,
              nextPage: response.next_page_parameters,
              parentKey,
              prefix,
            })
          } else {
            next.delete(scope)
          }
          return next
        })
        setPreviewed(true)
      } catch {
        setError(true)
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [credential.id, driveTransport, parameters, parametersValid, providerOption],
  )

  const toggle = (key: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else if (next.size < MAX_SELECTION) next.add(key)
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
        else {
          if (next.size >= MAX_SELECTION) break
          next.add(resource.key)
        }
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
  const visibleNextPageRequests = [...nextPageRequests.entries()].filter(
    ([scope]) => scope === ROOT_PAGE_SCOPE || expanded.has(scope),
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SourceNameField
          disabled={disabled}
          draft={draft}
          preventSubmitOnEnter
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
      <DatasourceParameterForm
        disabled={disabled || loading}
        parameters={parameters}
        schemas={parameterSchemas}
        onChange={(nextParameters) => {
          setResources([])
          setSelected(new Set())
          setExpanded(new Set())
          setNextPageRequests(new Map())
          setPreviewed(false)
          onDraftChange({ ...draft, parameters: nextParameters })
        }}
      />
      {!previewed && (
        <Button
          type="button"
          variant="primary"
          className="w-full"
          loading={loading}
          disabled={disabled || loading || !parametersValid}
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
              aria-describedby={selectionAtLimit ? SELECTION_LIMIT_ID : undefined}
              checked={
                selectableResources.length > 0 &&
                selectableResources.every((resource) => selected.has(resource.key))
              }
              disabled={
                disabled ||
                !selectableResources.length ||
                (selectionAtLimit &&
                  !selectableResources.every((resource) => selected.has(resource.key)))
              }
              indeterminate={
                selected.size > 0 &&
                !selectableResources.every((resource) => selected.has(resource.key))
              }
              onCheckedChange={toggleAll}
            />
            <span className="system-xs-medium text-text-secondary">
              {draft.sourceType === 'onlineDocuments'
                ? t(($) => $['newKnowledge.selectPagesToSync'])
                : t(($) => $['newKnowledge.selectFilesAndFolders'])}
            </span>
            <span role="status" className="ml-auto system-xs-regular text-text-tertiary">
              {t(($) => $['newKnowledge.pagesSelected'], { count: selected.size })}
              {selectionAtLimit && (
                <span id={SELECTION_LIMIT_ID} className="ml-2 text-text-destructive">
                  {t(($) => $['newKnowledge.maxPages'])}: {MAX_SELECTION}
                </span>
              )}
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
                      aria-expanded={expanded.has(resource.key)}
                      disabled={disabled || loadingMore}
                      onClick={() => expandContainer(resource)}
                    >
                      <span
                        aria-hidden
                        className={`i-ri-arrow-right-s-line size-4 transition-transform motion-reduce:transition-none ${
                          expanded.has(resource.key) ? 'rotate-90' : ''
                        }`}
                      />
                    </Button>
                  ) : (
                    <Checkbox
                      aria-label={resourceName(resource)}
                      aria-describedby={
                        selectionAtLimit && !selected.has(resource.key)
                          ? SELECTION_LIMIT_ID
                          : undefined
                      }
                      checked={selected.has(resource.key)}
                      disabled={disabled || (selectionAtLimit && !selected.has(resource.key))}
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
          {visibleNextPageRequests.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2 border-t border-divider-subtle px-3 py-2 text-center">
              {visibleNextPageRequests.map(([scope, request]) => {
                const parent =
                  scope === ROOT_PAGE_SCOPE ? undefined : resources.find(({ key }) => key === scope)
                return (
                  <Button
                    key={scope}
                    type="button"
                    size="small"
                    variant="ghost"
                    loading={loadingMore}
                    onClick={() => void requestPreview({ append: true, ...request })}
                  >
                    {t(($) => $['newKnowledge.loadMore'])}
                    {parent ? ` · ${resourceName(parent)}` : ''}
                  </Button>
                )
              })}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
