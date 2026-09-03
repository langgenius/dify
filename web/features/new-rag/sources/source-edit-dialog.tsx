'use client'

import type { KnowledgeFsSpaceCreatePayload } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type {
  DatasourceParameters,
  DatasourceParameterSchema,
} from './setup/datasource-parameter-model'
import type {
  NewKnowledgeOnlineDocumentsSourceDraft,
  NewKnowledgeOnlineDriveSourceDraft,
} from './setup/source-draft'
import type { SourceEditValues } from './source-list-model'
import type { CrawlPreviewPage, Source, SourceSyncPolicy } from './source-models'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Input } from '@langgenius/dify-ui/input'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleClient, consoleQuery } from '@/service/client'
import { useDataSourceList } from '@/service/use-pipeline'
import { ConnectedSourceEditForm } from './setup/connected-source-configuration'
import { CrawlPreviewPageSelection } from './setup/crawl-selection'
import { WebsiteDatasourceParameterForm } from './setup/datasource-parameter-form'
import {
  datasourceParameterRecord,
  invalidDatasourceParameters,
  missingRequiredDatasourceParameters,
  websiteDatasourceParameterSchemas,
  withDatasourceParameterDefaults,
} from './setup/datasource-parameter-model'
import {
  discoverSourceProviderOptions,
  normalizeSourceProviderName,
} from './setup/provider-options'
import {
  NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH,
  normalizeWebsiteSourceUrl,
} from './setup/source-draft'
import { SyncPolicyField } from './setup/sync-policy-field'
import {
  metadataString,
  sourceCustomIntervalHours,
  sourceProviderDetails,
  sourceSyncMode,
  syncPolicyConfiguration,
} from './source-list-model'
import { sourceConnectionListFromApi } from './source-models'

const MIN_CUSTOM_INTERVAL_HOURS = 1
const MAX_CUSTOM_INTERVAL_HOURS = 720
const CONNECTION_PAGE_SIZE = 200
const CRAWL_POLL_INTERVAL_MS = 1500
type InitialSource = NonNullable<KnowledgeFsSpaceCreatePayload['initial_source']>
type ConnectedInitialSource = Extract<InitialSource, { kind: 'online_document' | 'online_drive' }>
type ConnectedSourceDraft =
  | NewKnowledgeOnlineDocumentsSourceDraft
  | NewKnowledgeOnlineDriveSourceDraft

function sourceWebsiteParameters(source: Source): DatasourceParameters {
  const parameters = { ...(datasourceParameterRecord(source.metadata.parameters) ?? {}) }
  if (parameters.url === undefined) {
    const normalizedUrl = normalizeWebsiteSourceUrl(source.uri)
    if (normalizedUrl) parameters.url = normalizedUrl.toString()
  }
  return parameters
}

function sourceCrawlOptions(source: Source): Record<string, unknown> {
  const value = source.metadata.crawlOptions
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function sourceParametersForSchemas(
  source: Source,
  parameters: DatasourceParameters,
  schemas: DatasourceParameterSchema[],
) {
  const next = { ...parameters }
  const storedOptions = sourceCrawlOptions(source)
  const includeSubpagesSchema = schemas.find(
    (schema) => schema.name === 'crawl_subpages' || schema.name === 'crawl_sub_pages',
  )
  const includeSubpages =
    parameters.crawl_subpages ?? parameters.crawl_sub_pages ?? storedOptions.includeSubpages
  if (
    includeSubpagesSchema &&
    next[includeSubpagesSchema.name] === undefined &&
    typeof includeSubpages === 'boolean'
  )
    next[includeSubpagesSchema.name] = includeSubpages
  if (
    schemas.some((schema) => schema.name === 'limit') &&
    next.limit === undefined &&
    typeof storedOptions.limit === 'number'
  )
    next.limit = storedOptions.limit
  return withDatasourceParameterDefaults(schemas, next)
}

function connectedDraftFromSource(source: Source): ConnectedSourceDraft | undefined {
  const providerKind = metadataString(source.metadata, 'providerKind')
  const sourceType =
    providerKind === 'online-document'
      ? ('onlineDocuments' as const)
      : providerKind === 'online-drive'
        ? ('onlineDrive' as const)
        : undefined
  if (!sourceType) return undefined
  const syncMode = sourceSyncMode(source)
  const customIntervalSeconds = source.syncPolicy?.customIntervalSeconds
  return {
    ...(syncMode === 'custom' && customIntervalSeconds ? { customIntervalSeconds } : {}),
    parameters: datasourceParameterRecord(source.metadata.parameters) ?? {},
    provider:
      metadataString(source.metadata, 'providerName') ?? sourceProviderDetails(source).name ?? '',
    sourceName: source.name,
    sourceType,
    syncPolicy: syncMode === 'interval' ? 'daily' : syncMode,
  }
}

export function SourceEditDialog({
  controlSpaceId,
  onEdit,
  onOpenChange,
  open,
  pending,
  source,
}: {
  controlSpaceId: string
  onEdit: (values: SourceEditValues) => Promise<boolean>
  onOpenChange: (open: boolean) => void
  open: boolean
  pending: boolean
  source: Source
}) {
  const connectedDraft = connectedDraftFromSource(source)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          connectedDraft
            ? 'max-h-[calc(100vh-2rem)] w-180! max-w-[calc(100vw-2rem)]! overflow-y-auto'
            : 'w-160! max-w-[calc(100vw-2rem)]!'
        }
      >
        <SourceEditDialogContent
          connectedDraft={connectedDraft}
          controlSpaceId={controlSpaceId}
          onEdit={onEdit}
          onOpenChange={onOpenChange}
          pending={pending}
          source={source}
        />
      </DialogContent>
    </Dialog>
  )
}

function SourceEditDialogContent(props: {
  connectedDraft?: ConnectedSourceDraft
  controlSpaceId: string
  onEdit: (values: SourceEditValues) => Promise<boolean>
  onOpenChange: (open: boolean) => void
  pending: boolean
  source: Source
}) {
  if (props.connectedDraft)
    return <ConnectedSourceEditDialogContent {...props} initialDraft={props.connectedDraft} />
  if (props.source.type === 'web') return <WebsiteSourceEditDialogContent {...props} />
  return <BasicSourceEditDialogContent {...props} />
}

function ConnectedSourceEditDialogContent({
  controlSpaceId,
  initialDraft,
  onEdit,
  onOpenChange,
  pending,
  source,
}: {
  controlSpaceId: string
  initialDraft: ConnectedSourceDraft
  onEdit: (values: SourceEditValues) => Promise<boolean>
  onOpenChange: (open: boolean) => void
  pending: boolean
  source: Source
}) {
  const { t: tCommon } = useTranslation('common')
  const { t } = useTranslation('knowledgeSpace')
  const datasourcePluginsQuery = useDataSourceList(true)
  const {
    data: connectionsData,
    fetchNextPage,
    hasNextPage,
    isError: connectionsError,
    isFetchingNextPage,
    isPending: connectionsPending,
  } = useInfiniteQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.sourceConnections.get.infiniteOptions({
      context: { silent: true },
      enabled: Boolean(source.connectionId),
      input: (pageParam) => ({
        params: { control_space_id: controlSpaceId },
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
    () => discoverSourceProviderOptions(initialDraft.sourceType, datasourcePluginsQuery.data ?? []),
    [datasourcePluginsQuery.data, initialDraft.sourceType],
  )
  const normalizedProviderName = normalizeSourceProviderName(initialDraft.provider)
  const providerOption = providerOptions.find(
    (option) => normalizeSourceProviderName(option.label) === normalizedProviderName,
  )
  const installedProviderOption = providerOption
  const connections =
    connectionsData?.pages.flatMap((page) => sourceConnectionListFromApi(page).items) ?? []
  const connection = connections.find((item) => item.id === source.connectionId)
  const connectionConfiguration = connection?.configuration
  const credentialId = connectionConfiguration?.credentialId
  const datasource = connectionConfiguration?.datasource
  const pluginId = connectionConfiguration?.pluginId
  const provider = connectionConfiguration?.provider
  const bindingReady =
    typeof credentialId === 'string' &&
    typeof datasource === 'string' &&
    typeof pluginId === 'string' &&
    typeof provider === 'string'
  const previewBinding = useMemo(
    () =>
      bindingReady && installedProviderOption
        ? {
            credentialId,
            datasource,
            pluginId,
            provider,
            providerDisplayName: installedProviderOption.label,
          }
        : undefined,
    [bindingReady, credentialId, datasource, installedProviderOption, pluginId, provider],
  )
  useEffect(() => {
    if (source.connectionId && !connection && hasNextPage && !isFetchingNextPage)
      void fetchNextPage()
  }, [connection, fetchNextPage, hasNextPage, isFetchingNextPage, source.connectionId])

  const submitEdit = async (submission: ConnectedInitialSource) => {
    if (pending) return false
    const syncPolicy =
      submission.sync_policy === 'manual'
        ? ({ enabled: false, mode: 'manual' } as const)
        : submission.sync_policy === 'custom'
          ? ({
              customIntervalSeconds: submission.custom_interval_seconds,
              enabled: true,
              mode: 'custom',
            } as const)
          : ({ enabled: true, mode: 'interval' } as const)
    const accepted = await onEdit({
      expectedVersion: source.version,
      name: submission.name,
      providerParameters: datasourceParameterRecord(submission.parameters) ?? {},
      selection:
        submission.kind === 'online_document'
          ? { items: submission.selection, kind: 'online_document' }
          : { items: submission.selection, kind: 'online_drive' },
      syncPolicy,
    })
    if (accepted) onOpenChange(false)
    return accepted
  }

  const loading = datasourcePluginsQuery.isPending || connectionsPending
  const unavailable =
    datasourcePluginsQuery.isError ||
    connectionsError ||
    !installedProviderOption ||
    (!loading && !bindingReady)

  return (
    <>
      <DialogTitle className="title-xl-semi-bold text-text-primary">
        {tCommon(($) => $['operation.edit'])} {source.name}
      </DialogTitle>
      <div className="mt-5">
        {loading ? (
          <div role="status" aria-label={tCommon(($) => $.loading)} className="py-16 text-center">
            <span
              aria-hidden
              className="i-ri-loader-4-line inline-block size-5 animate-spin text-text-tertiary"
            />
          </div>
        ) : unavailable || !installedProviderOption || !previewBinding ? (
          <p role="alert" className="py-8 system-sm-regular text-text-destructive">
            {datasourcePluginsQuery.isError || connectionsError
              ? t(($) => $.providerLoadFailed)
              : t(($) => $.providerUnavailable)}
          </p>
        ) : (
          <ConnectedSourceEditForm
            disabled={pending}
            initialDraft={initialDraft}
            previewBinding={previewBinding}
            providerOption={installedProviderOption}
            onCancel={() => onOpenChange(false)}
            onSubmit={submitEdit}
          />
        )}
      </div>
      {(loading || unavailable) && (
        <div className="mt-6 flex justify-end gap-2">
          <Button disabled={pending} onClick={() => onOpenChange(false)} type="button">
            {tCommon(($) => $['operation.cancel'])}
          </Button>
        </div>
      )}
    </>
  )
}

function BasicSourceEditDialogContent({
  onEdit,
  onOpenChange,
  pending,
  source,
}: {
  onEdit: (values: SourceEditValues) => Promise<boolean>
  onOpenChange: (open: boolean) => void
  pending: boolean
  source: Source
}) {
  const { t } = useTranslation('knowledgeSpace')
  const { t: tCommon } = useTranslation('common')
  const [initialSource] = useState(source)
  const [nextName, setNextName] = useState(initialSource.name)
  const [nextSyncMode, setNextSyncMode] = useState<SourceSyncPolicy['mode']>(() =>
    sourceSyncMode(initialSource),
  )
  const [nextCustomIntervalHours, setNextCustomIntervalHours] = useState<number | ''>(() =>
    sourceCustomIntervalHours(initialSource),
  )
  const customIntervalValid =
    typeof nextCustomIntervalHours === 'number' &&
    Number.isInteger(nextCustomIntervalHours) &&
    nextCustomIntervalHours >= MIN_CUSTOM_INTERVAL_HOURS &&
    nextCustomIntervalHours <= MAX_CUSTOM_INTERVAL_HOURS

  const submitEdit = async () => {
    const name = nextName.trim()
    if (!name || !customIntervalValid || pending) return
    if (
      await onEdit({
        expectedVersion: initialSource.version,
        name,
        syncPolicy: syncPolicyConfiguration(nextSyncMode, nextCustomIntervalHours as number),
      })
    )
      onOpenChange(false)
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void submitEdit()
      }}
    >
      <DialogTitle className="title-xl-semi-bold text-text-primary">
        {tCommon(($) => $['operation.edit'])} {initialSource.name}
      </DialogTitle>
      <div className="mt-5">
        <Field name="sourceName" className="gap-1.5">
          <FieldLabel htmlFor={`source-name-${initialSource.id}`}>
            {t(($) => $.sourceName)}
          </FieldLabel>
          <Input
            id={`source-name-${initialSource.id}`}
            autoComplete="off"
            disabled={pending}
            maxLength={NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH}
            value={nextName}
            onChange={(event) => setNextName(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-4">
        <SyncPolicyField
          disabled={pending}
          label
          triggerClassName="w-full"
          value={{
            customIntervalSeconds:
              typeof nextCustomIntervalHours === 'number'
                ? nextCustomIntervalHours * 3600
                : undefined,
            mode: nextSyncMode,
          }}
          onChange={(value) => {
            setNextSyncMode(value.mode)
            if (value.customIntervalSeconds)
              setNextCustomIntervalHours(value.customIntervalSeconds / 3600)
          }}
        />
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button disabled={pending} onClick={() => onOpenChange(false)} type="button">
          {tCommon(($) => $['operation.cancel'])}
        </Button>
        <Button
          disabled={!nextName.trim() || !customIntervalValid}
          loading={pending}
          type="submit"
          variant="primary"
        >
          {tCommon(($) => $['operation.save'])}
        </Button>
      </div>
    </form>
  )
}

function WebsiteSourceEditDialogContent({
  controlSpaceId,
  onEdit,
  onOpenChange,
  pending,
  source,
}: {
  controlSpaceId: string
  onEdit: (values: SourceEditValues) => Promise<boolean>
  onOpenChange: (open: boolean) => void
  pending: boolean
  source: Source
}) {
  const { t } = useTranslation('knowledgeSpace')
  const { t: tCommon } = useTranslation('common')
  const [initialSource] = useState(source)
  const providerName = sourceProviderDetails(initialSource).name ?? ''
  const providerKey = metadataString(initialSource.metadata, 'providerKey')
  const usesProviderDeclaration =
    initialSource.type === 'web' &&
    (initialSource.metadata.datasourceParameterMode === 'exact' ||
      Boolean(providerKey || providerName))
  const datasourcePluginsQuery = useDataSourceList(usesProviderDeclaration)
  const {
    data: connectionsData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.sourceConnections.get.infiniteOptions({
      context: { silent: true },
      enabled: initialSource.type === 'web' && Boolean(initialSource.connectionId),
      input: (pageParam) => ({
        params: { control_space_id: controlSpaceId },
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
  const [initialParameters] = useState(() => sourceWebsiteParameters(initialSource))
  const [nextName, setNextName] = useState(initialSource.name)
  const [nextParameters, setNextParameters] = useState(initialParameters)
  const [nextSyncMode, setNextSyncMode] = useState<SourceSyncPolicy['mode']>(() =>
    sourceSyncMode(initialSource),
  )
  const [nextCustomIntervalHours, setNextCustomIntervalHours] = useState<number | ''>(() =>
    sourceCustomIntervalHours(initialSource),
  )
  const [previewPages, setPreviewPages] = useState<CrawlPreviewPage[]>([])
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(() => new Set())
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState(false)
  const previewAttemptRef = useRef(0)
  const previewJobIdRef = useRef<string | undefined>(undefined)
  const providerOptions = useMemo(
    () => discoverSourceProviderOptions('websiteCrawl', datasourcePluginsQuery.data ?? []),
    [datasourcePluginsQuery.data],
  )
  const normalizedProviderName = normalizeSourceProviderName(providerName)
  const providerOption = providerOptions.find(
    (option) =>
      option.key === providerKey ||
      normalizeSourceProviderName(option.label) === normalizedProviderName,
  )
  const connections =
    connectionsData?.pages.flatMap((page) => sourceConnectionListFromApi(page).items) ?? []
  const connection = connections.find((item) => item.id === initialSource.connectionId)
  const connectionConfiguration = connection?.configuration
  const credentialId = connectionConfiguration?.credentialId
  const datasource = connectionConfiguration?.datasource
  const pluginId = connectionConfiguration?.pluginId
  const provider = connectionConfiguration?.provider
  const previewBindingReady =
    typeof credentialId === 'string' &&
    typeof datasource === 'string' &&
    typeof pluginId === 'string' &&
    typeof provider === 'string'
  const providerLoading = usesProviderDeclaration && datasourcePluginsQuery.isPending
  const providerLoadFailed = usesProviderDeclaration && datasourcePluginsQuery.isError
  const providerConfigurationReady =
    !usesProviderDeclaration || (!providerLoading && !providerLoadFailed && Boolean(providerOption))
  const parameterSchemas = useMemo(() => {
    if (!usesProviderDeclaration) return websiteDatasourceParameterSchemas()
    return providerOption ? websiteDatasourceParameterSchemas(providerOption.datasource) : []
  }, [providerOption, usesProviderDeclaration])
  const displayedParameters = useMemo(
    () => sourceParametersForSchemas(initialSource, nextParameters, parameterSchemas),
    [initialSource, nextParameters, parameterSchemas],
  )
  const customIntervalValid =
    typeof nextCustomIntervalHours === 'number' &&
    Number.isInteger(nextCustomIntervalHours) &&
    nextCustomIntervalHours >= MIN_CUSTOM_INTERVAL_HOURS &&
    nextCustomIntervalHours <= MAX_CUSTOM_INTERVAL_HOURS
  const parametersValid =
    initialSource.type !== 'web' ||
    !providerConfigurationReady ||
    (!missingRequiredDatasourceParameters(parameterSchemas, displayedParameters).length &&
      !invalidDatasourceParameters(parameterSchemas, displayedParameters).length)
  const websiteSelectionReady = initialSource.type !== 'web' || selectedPageIds.size > 0

  useEffect(() => {
    if (
      initialSource.type === 'web' &&
      initialSource.connectionId &&
      !connection &&
      hasNextPage &&
      !isFetchingNextPage
    )
      void fetchNextPage()
  }, [connection, fetchNextPage, hasNextPage, initialSource, isFetchingNextPage])

  useEffect(
    () => () => {
      previewAttemptRef.current += 1
      const jobId = previewJobIdRef.current
      if (jobId)
        void consoleClient.knowledgeFs.sourceProviderPreview.jobs.byJobId
          .delete({ params: { job_id: jobId } })
          .catch(() => {})
    },
    [],
  )

  const resetPreview = () => {
    previewAttemptRef.current += 1
    const jobId = previewJobIdRef.current
    previewJobIdRef.current = undefined
    if (jobId)
      void consoleClient.knowledgeFs.sourceProviderPreview.jobs.byJobId
        .delete({ params: { job_id: jobId } })
        .catch(() => {})
    setPreviewPages([])
    setSelectedPageIds(new Set())
    setPreviewError(false)
  }

  const startPreview = async () => {
    if (previewing || !parametersValid || !providerOption || !previewBindingReady) return
    const attempt = previewAttemptRef.current + 1
    previewAttemptRef.current = attempt
    setPreviewing(true)
    setPreviewError(false)
    setPreviewPages([])
    setSelectedPageIds(new Set())
    try {
      const job = await consoleClient.knowledgeFs.sourceProviderPreview.jobs.post({
        body: {
          credentialId,
          datasource,
          kind: 'website_crawl',
          parameters: displayedParameters,
          pluginId,
          provider,
          providerDisplayName: providerOption.label,
        },
      })
      if (previewAttemptRef.current !== attempt) return
      previewJobIdRef.current = job.job_id
      let response = await consoleClient.knowledgeFs.sourceProviderPreview.jobs.byJobId.get({
        params: { job_id: job.job_id },
      })
      while (
        previewAttemptRef.current === attempt &&
        !['completed', 'failed', 'canceled'].includes(response.status)
      ) {
        await new Promise((resolve) => globalThis.setTimeout(resolve, CRAWL_POLL_INTERVAL_MS))
        if (previewAttemptRef.current !== attempt) return
        response = await consoleClient.knowledgeFs.sourceProviderPreview.jobs.byJobId.get({
          params: { job_id: job.job_id },
        })
      }
      if (previewAttemptRef.current !== attempt) return
      previewJobIdRef.current = undefined
      if (response.status !== 'completed' || !response.result) {
        setPreviewError(true)
        return
      }
      setPreviewPages(
        (response.result.pages ?? []).map((page) => ({
          description: page.description ?? undefined,
          pageId: page.source_url,
          sourceUrl: page.source_url,
          title: page.title ?? page.source_url,
        })),
      )
    } catch {
      if (previewAttemptRef.current === attempt) setPreviewError(true)
    } finally {
      if (previewAttemptRef.current === attempt) setPreviewing(false)
    }
  }
  const submitEdit = async () => {
    const name = nextName.trim()
    if (!name || !customIntervalValid || !parametersValid || !websiteSelectionReady || pending)
      return
    const normalizedUrl =
      initialSource.type === 'web' && typeof displayedParameters.url === 'string'
        ? normalizeWebsiteSourceUrl(displayedParameters.url)
        : undefined
    if (
      await onEdit({
        expectedVersion: initialSource.version,
        name,
        ...(initialSource.type === 'web'
          ? {
              providerParameters: displayedParameters,
              selection: {
                kind: 'website_crawl' as const,
                sourceUrls: previewPages
                  .filter((page) => selectedPageIds.has(page.pageId))
                  .map((page) => page.sourceUrl),
              },
              ...(normalizedUrl ? { uri: normalizedUrl.toString() } : {}),
            }
          : {}),
        syncPolicy: syncPolicyConfiguration(nextSyncMode, nextCustomIntervalHours as number),
      })
    )
      onOpenChange(false)
  }

  const sourceNameField = (
    <Field name="sourceName" className="gap-1.5">
      <FieldLabel htmlFor={`source-name-${initialSource.id}`}>{t(($) => $.sourceName)}</FieldLabel>
      <Input
        id={`source-name-${initialSource.id}`}
        autoComplete="off"
        disabled={pending}
        maxLength={NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH}
        value={nextName}
        onChange={(event) => setNextName(event.target.value)}
      />
    </Field>
  )

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submitEdit()
        }}
      >
        <DialogTitle className="title-xl-semi-bold text-text-primary">
          {tCommon(($) => $['operation.edit'])} {initialSource.name}
        </DialogTitle>
        {initialSource.type === 'web' ? (
          <div className="mt-5">
            {providerConfigurationReady ? (
              <WebsiteDatasourceParameterForm
                additionalPrimaryField={sourceNameField}
                disabled={pending}
                parameters={displayedParameters}
                schemas={parameterSchemas}
                onChange={(parameters) => {
                  setNextParameters(parameters)
                  resetPreview()
                }}
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {sourceNameField}
                {providerLoading ? (
                  <div
                    role="status"
                    aria-label={tCommon(($) => $.loading)}
                    className="space-y-2 pt-0.5"
                  >
                    <span className="block h-4 w-24 animate-pulse rounded bg-util-colors-gray-gray-200 motion-reduce:animate-none" />
                    <span className="block h-8 w-full animate-pulse rounded-lg bg-util-colors-gray-gray-200 motion-reduce:animate-none" />
                  </div>
                ) : (
                  <p role="alert" className="pt-7 system-sm-regular text-text-destructive">
                    {providerLoadFailed
                      ? t(($) => $.providerLoadFailed)
                      : t(($) => $.providerUnavailable)}
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-5">{sourceNameField}</div>
        )}
        {initialSource.type === 'web' && providerConfigurationReady && (
          <div className="mt-4">
            {!previewPages.length && (
              <Button
                className="w-full"
                disabled={
                  pending ||
                  previewing ||
                  !parametersValid ||
                  !providerOption ||
                  !previewBindingReady
                }
                loading={previewing}
                type="button"
                variant="primary"
                onClick={() => void startPreview()}
              >
                {t(($) => $.preview)}
              </Button>
            )}
            {previewError && (
              <p role="alert" className="mt-2 system-sm-regular text-text-destructive">
                {t(($) => $.providerLoadFailed)}
              </p>
            )}
            {previewPages.length > 0 && (
              <CrawlPreviewPageSelection
                disabled={pending}
                onRecrawl={() => void startPreview()}
                onSelectionChange={setSelectedPageIds}
                pages={previewPages}
                rootUrl={
                  typeof displayedParameters.url === 'string'
                    ? normalizeWebsiteSourceUrl(displayedParameters.url)?.toString()
                    : undefined
                }
                selectedPageIds={selectedPageIds}
                sourceLabel={providerOption?.label}
              />
            )}
          </div>
        )}
        <div className="mt-4">
          <SyncPolicyField
            disabled={pending}
            label
            triggerClassName="w-full"
            value={{
              customIntervalSeconds:
                typeof nextCustomIntervalHours === 'number'
                  ? nextCustomIntervalHours * 3600
                  : undefined,
              mode: nextSyncMode,
            }}
            onChange={(value) => {
              setNextSyncMode(value.mode)
              if (value.customIntervalSeconds)
                setNextCustomIntervalHours(value.customIntervalSeconds / 3600)
            }}
          />
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button disabled={pending} onClick={() => onOpenChange(false)} type="button">
            {tCommon(($) => $['operation.cancel'])}
          </Button>
          <Button
            disabled={
              !nextName.trim() || !customIntervalValid || !parametersValid || !websiteSelectionReady
            }
            loading={pending}
            type="submit"
            variant="primary"
          >
            {tCommon(($) => $['operation.save'])}
          </Button>
        </div>
      </form>
    </>
  )
}
