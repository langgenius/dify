'use client'

import type { KnowledgeFsSpaceCreatePayload } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { NewKnowledgeSourceDraft } from './routes'
import type { CrawlPreviewPage } from './source-models'
import type {
  DataSourceAuth,
  DataSourceCredential,
} from '@/app/components/header/account-setting/data-source-page-new/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { buildIntegrationPath } from '@/app/components/integrations/routes'
import { consoleClient } from '@/service/client'
import { useGetDataSourceListAuth } from '@/service/use-datasource'
import { useDataSourceList } from '@/service/use-pipeline'
import { CrawlPreviewPageSelection } from './crawl-selection-form'
import { CreateConnectedSourceSetup } from './create-connected-source-setup'
import { WebsiteDatasourceParameterForm } from './datasource-parameter-form'
import {
  datasourceIncludeSubpages,
  datasourceParameterDefaults,
  datasourceParameterSchemas,
  invalidDatasourceParameters,
  missingRequiredDatasourceParameters,
  websiteDatasourceParameterSchemas,
  withDatasourceParameterDefaults,
} from './datasource-parameter-model'
import {
  discoverSourceProviderOptions,
  sourceProviderOptionForDraft,
} from './source-provider-options'
import {
  SourceNameField,
  SourceProviderCredentialRequiredCard,
  SourceProviderIcon,
  SourceProviderNotInstalledCard,
  SourceProviderRadioGroup,
  SourceSyncPolicyField,
  SourceTypeSelector,
} from './source-setup-fields'

const CRAWL_PREVIEW_SKELETONS = [
  { id: 'short', sourceWidth: 'w-22.5', titleWidth: 'w-37.5' },
  { id: 'medium', sourceWidth: 'w-26', titleWidth: 'w-42.5' },
  { id: 'long', sourceWidth: 'w-29.5', titleWidth: 'w-47.5' },
  { id: 'longest', sourceWidth: 'w-33', titleWidth: 'w-52.5' },
] as const
const CRAWL_POLL_INTERVAL_MS = 1500

type LocalCrawlState = 'error' | 'idle' | 'running' | 'stopped' | 'success'
type InitialSource = NonNullable<KnowledgeFsSpaceCreatePayload['initial_source']>

function datasourceAuthForProvider(
  authProviders: DataSourceAuth[],
  pluginId: string,
  provider: string,
) {
  return authProviders.find(
    (candidate) => candidate.plugin_id === pluginId && candidate.provider === provider,
  )
}

function preferredCredential(auth?: DataSourceAuth): DataSourceCredential | undefined {
  return (
    auth?.credentials_list.find((credential) => credential.is_default) ?? auth?.credentials_list[0]
  )
}

function providerIntegrationPath(packageId?: string) {
  const base = buildIntegrationPath('data-source')
  if (!packageId) return base
  const query = new URLSearchParams({ 'package-ids': JSON.stringify([packageId]) })
  return `${base}?${query.toString()}`
}

function websiteSourceUri(parameters: Record<string, boolean | number | string>, fallback: string) {
  const url = parameters.url
  if (typeof url === 'string') {
    try {
      const parsed = new URL(url)
      if (['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password)
        return parsed.toString()
    } catch {
      // Non-URL website datasources use a stable synthetic URI.
    }
  }
  return `datasource://${encodeURIComponent(fallback)}`
}

export function CreateSourceSetup({
  disabled,
  draft,
  onDraftChange,
  onInitialSourceChange,
  onSourceTypeChange,
}: {
  disabled: boolean
  draft: NewKnowledgeSourceDraft
  onDraftChange: (draft: NewKnowledgeSourceDraft) => void
  onInitialSourceChange: (source?: InitialSource) => void
  onSourceTypeChange: (sourceType: NewKnowledgeSourceDraft['sourceType']) => void
}) {
  const { t } = useTranslation('dataset')
  const datasourcePluginsQuery = useDataSourceList(true)
  const datasourceAuthQuery = useGetDataSourceListAuth()
  const [crawlState, setCrawlState] = useState<LocalCrawlState>('idle')
  const [stoppingPreview, setStoppingPreview] = useState(false)
  const [previewPages, setPreviewPages] = useState<CrawlPreviewPage[]>([])
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(() => new Set())
  const crawlAttemptRef = useRef(0)
  const previewJobIdRef = useRef<string | undefined>(undefined)
  const sourceType = draft.sourceType
  const providerOptions = useMemo(
    () => discoverSourceProviderOptions(sourceType, datasourcePluginsQuery.data ?? []),
    [datasourcePluginsQuery.data, sourceType],
  )
  const providerOption = sourceProviderOptionForDraft(providerOptions, draft)
  const installedProviderOption = providerOption?.installed ? providerOption : undefined
  const datasourceAuth = installedProviderOption
    ? datasourceAuthForProvider(
        datasourceAuthQuery.data?.result ?? [],
        installedProviderOption.plugin.plugin_id,
        installedProviderOption.plugin.provider,
      )
    : undefined
  const credential = preferredCredential(datasourceAuth)
  const parameterSchemas = useMemo(
    () =>
      draft.sourceType === 'websiteCrawl' && installedProviderOption
        ? websiteDatasourceParameterSchemas(installedProviderOption.datasource)
        : [],
    [draft.sourceType, installedProviderOption],
  )
  const parameters = useMemo(() => {
    const current = withDatasourceParameterDefaults(parameterSchemas, draft.parameters)
    if (
      draft.sourceType === 'websiteCrawl' &&
      draft.rootUrl &&
      parameterSchemas.some((parameter) => parameter.name === 'url') &&
      current.url === undefined
    )
      current.url = draft.rootUrl
    return current
  }, [draft, parameterSchemas])
  const parametersValid =
    !missingRequiredDatasourceParameters(parameterSchemas, parameters).length &&
    !invalidDatasourceParameters(parameterSchemas, parameters).length
  const selectionPages = previewPages
  const previewReady = Boolean(
    draft.sourceType === 'websiteCrawl' &&
    credential &&
    installedProviderOption &&
    parametersValid &&
    draft.sourceName.trim(),
  )
  const sourceUri = installedProviderOption
    ? websiteSourceUri(parameters, installedProviderOption.key)
    : ''
  const selectionRootUrl =
    typeof parameters.url === 'string' && sourceUri.startsWith('http') ? sourceUri : undefined
  const cancelPreviewBestEffort = () => {
    crawlAttemptRef.current += 1
    const jobId = previewJobIdRef.current
    previewJobIdRef.current = undefined
    if (jobId)
      void consoleClient.knowledgeFs.sourceProviderPreview.jobs.byJobId
        .delete({
          params: { job_id: jobId },
        })
        .catch(() => {})
  }
  const stopPreview = async () => {
    if (stoppingPreview) return
    crawlAttemptRef.current += 1
    const jobId = previewJobIdRef.current
    if (!jobId) {
      setCrawlState('stopped')
      return
    }
    setStoppingPreview(true)
    try {
      const response = await consoleClient.knowledgeFs.sourceProviderPreview.jobs.byJobId.delete({
        params: { job_id: jobId },
      })
      if (response.status === 'completed' && response.result) {
        if (previewJobIdRef.current === jobId) previewJobIdRef.current = undefined
        setPreviewPages(
          (response.result.pages ?? []).map((page) => ({
            description: page.description ?? undefined,
            pageId: page.source_url,
            sourceUrl: page.source_url,
            title: page.title ?? page.source_url,
          })),
        )
        setCrawlState('success')
      } else if (response.status === 'canceled') {
        if (previewJobIdRef.current === jobId) previewJobIdRef.current = undefined
        setCrawlState('stopped')
      } else if (response.status === 'failed') {
        if (previewJobIdRef.current === jobId) previewJobIdRef.current = undefined
        setCrawlState('error')
      } else {
        setCrawlState('running')
      }
    } catch {
      // Keep the job handle and running state so Stop can be retried and unmount
      // cleanup can still revoke a task whose cancellation response was lost.
      setCrawlState('running')
    } finally {
      setStoppingPreview(false)
    }
  }
  const resetPreview = () => {
    cancelPreviewBestEffort()
    setCrawlState('idle')
    setPreviewPages([])
    setSelectedPageIds(new Set())
    onInitialSourceChange(undefined)
  }
  const updateDraft = (nextDraft: NewKnowledgeSourceDraft) => {
    onDraftChange(nextDraft)
    resetPreview()
  }
  const updateDraftWithoutReset = (nextDraft: NewKnowledgeSourceDraft) => {
    onDraftChange(nextDraft)
  }
  const selectProvider = (providerKey: string) => {
    const nextProvider = providerOptions.find((option) => option.key === providerKey)
    if (!nextProvider) return
    updateDraft({
      ...draft,
      parameters: nextProvider.installed
        ? datasourceParameterDefaults(
            draft.sourceType === 'websiteCrawl'
              ? websiteDatasourceParameterSchemas(nextProvider.datasource)
              : datasourceParameterSchemas(nextProvider.datasource),
          )
        : {},
      provider: nextProvider.label,
      providerKey: nextProvider.key,
      sourceName: '',
      ...(draft.sourceType === 'websiteCrawl' ? { rootUrl: '' } : {}),
    })
  }

  useEffect(
    () => () => {
      crawlAttemptRef.current += 1
      const jobId = previewJobIdRef.current
      if (jobId)
        void consoleClient.knowledgeFs.sourceProviderPreview.jobs.byJobId
          .delete({
            params: { job_id: jobId },
          })
          .catch(() => {})
    },
    [],
  )

  const startPreview = async () => {
    if (
      draft.sourceType !== 'websiteCrawl' ||
      !previewReady ||
      !credential ||
      !installedProviderOption
    )
      return
    const attempt = crawlAttemptRef.current + 1
    crawlAttemptRef.current = attempt
    setPreviewPages([])
    setSelectedPageIds(new Set())
    setCrawlState('running')
    try {
      const job = await consoleClient.knowledgeFs.sourceProviderPreview.jobs.post({
        body: {
          credentialId: credential.id,
          datasource: installedProviderOption.datasource.identity.name,
          kind: 'website_crawl',
          parameters,
          pluginId: installedProviderOption.plugin.plugin_id,
          provider: installedProviderOption.plugin.provider,
          providerDisplayName: installedProviderOption.label,
        },
      })
      if (crawlAttemptRef.current !== attempt) {
        void consoleClient.knowledgeFs.sourceProviderPreview.jobs.byJobId
          .delete({
            params: { job_id: job.job_id },
          })
          .catch(() => {})
        return
      }
      previewJobIdRef.current = job.job_id
      let response = await consoleClient.knowledgeFs.sourceProviderPreview.jobs.byJobId.get({
        params: { job_id: job.job_id },
      })
      while (
        crawlAttemptRef.current === attempt &&
        !['completed', 'failed', 'canceled'].includes(response.status)
      ) {
        await new Promise((resolve) => globalThis.setTimeout(resolve, CRAWL_POLL_INTERVAL_MS))
        if (crawlAttemptRef.current !== attempt) return
        response = await consoleClient.knowledgeFs.sourceProviderPreview.jobs.byJobId.get({
          params: { job_id: job.job_id },
        })
      }
      if (crawlAttemptRef.current !== attempt) return
      previewJobIdRef.current = undefined
      if (response.status !== 'completed' || !response.result) {
        setCrawlState(response.status === 'canceled' ? 'stopped' : 'error')
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
      setCrawlState('success')
    } catch {
      if (crawlAttemptRef.current === attempt) {
        const jobId = previewJobIdRef.current
        previewJobIdRef.current = undefined
        if (jobId)
          void consoleClient.knowledgeFs.sourceProviderPreview.jobs.byJobId
            .delete({
              params: { job_id: jobId },
            })
            .catch(() => {})
        setCrawlState('error')
      }
    }
  }

  const updateSelectedPageIds = (pageIds: Set<string>) => {
    setSelectedPageIds(pageIds)
  }

  useEffect(() => {
    if (draft.sourceType !== 'websiteCrawl') {
      if (!installedProviderOption || !credential) onInitialSourceChange(undefined)
      return
    }
    if (
      crawlState !== 'success' ||
      !selectionPages.length ||
      !installedProviderOption ||
      !credential
    ) {
      onInitialSourceChange(undefined)
      return
    }
    const selectedPages = selectionPages.filter((page) => selectedPageIds.has(page.pageId))
    if (!selectedPages.length) {
      onInitialSourceChange(undefined)
      return
    }
    onInitialSourceChange({
      crawl_options: {
        include_subpages: datasourceIncludeSubpages(parameters),
        limit: typeof parameters.limit === 'number' ? parameters.limit : 200,
      },
      credentialId: credential.id,
      datasource: installedProviderOption.datasource.identity.name,
      kind: 'website_crawl',
      name: draft.sourceName.trim(),
      pluginId: installedProviderOption.plugin.plugin_id,
      provider: installedProviderOption.plugin.provider,
      providerDisplayName: installedProviderOption.label,
      parameters,
      root_url: sourceUri,
      selection: selectedPages.map((page) => ({
        source_url: page.sourceUrl,
        ...(page.title ? { title: page.title } : {}),
      })),
      ...(draft.syncPolicy === 'custom' && draft.customIntervalSeconds
        ? { custom_interval_seconds: draft.customIntervalSeconds }
        : {}),
      sync_policy: draft.syncPolicy,
    })
  }, [
    crawlState,
    credential,
    draft,
    installedProviderOption,
    onInitialSourceChange,
    parameters,
    selectedPageIds,
    selectionPages,
    sourceUri,
  ])

  return (
    <div className="mx-4 -mt-1 mb-3.75 flex flex-col gap-4">
      <SourceTypeSelector
        appearance="embedded"
        disabled={disabled}
        value={sourceType}
        onChange={(value) => {
          onSourceTypeChange(value)
        }}
      />

      <Fieldset disabled={disabled}>
        <FieldsetLegend className="sr-only">
          {t(($) => $['newKnowledge.providerLabel'])}
        </FieldsetLegend>
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <span className="system-xs-medium text-text-secondary">
            {t(($) => $['newKnowledge.providerLabel'])}
          </span>
          <Button
            type="button"
            variant="ghost-accent"
            size="small"
            disabled={disabled}
            className="gap-0.5 px-2.75"
            onClick={() =>
              globalThis.open(buildIntegrationPath('data-source'), '_blank', 'noopener,noreferrer')
            }
          >
            {t(($) => $['newKnowledge.moreProviders'])}
            <span aria-hidden className="i-ri-arrow-right-up-line size-3.5" />
          </Button>
        </div>
        <SourceProviderRadioGroup
          value={providerOption?.key ?? ''}
          disabled={disabled}
          layout={sourceType === 'websiteCrawl' ? 'grid-four' : 'grid-three'}
          options={providerOptions.map((option) => ({
            icon: <SourceProviderIcon fallbackIcon={option.fallbackIcon} />,
            label: option.label,
            value: option.key,
          }))}
          surface="default"
          onChange={selectProvider}
        />
      </Fieldset>

      {datasourcePluginsQuery.isPending || datasourceAuthQuery.isPending ? (
        <div className="flex min-h-44 items-center justify-center">
          <span aria-hidden className="i-ri-loader-4-line size-5 animate-spin text-text-tertiary" />
        </div>
      ) : datasourcePluginsQuery.error || datasourceAuthQuery.error ? (
        <div className="rounded-xl bg-background-section p-4">
          <p className="system-sm-semibold text-text-primary">
            {t(($) => $['newKnowledge.providerLoadFailed'])}
          </p>
          <Button
            className="mt-3"
            onClick={() =>
              void Promise.all([datasourcePluginsQuery.refetch(), datasourceAuthQuery.refetch()])
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
              providerIntegrationPath(providerOption.packageId),
              '_blank',
              'noopener,noreferrer',
            )
          }
        />
      ) : installedProviderOption && !credential ? (
        <SourceProviderCredentialRequiredCard
          disabled={disabled}
          icon={<SourceProviderIcon fallbackIcon={installedProviderOption.fallbackIcon} />}
          provider={installedProviderOption.label}
          onConnect={() =>
            globalThis.open(
              providerIntegrationPath(installedProviderOption.packageId),
              '_blank',
              'noopener,noreferrer',
            )
          }
        />
      ) : draft.sourceType === 'websiteCrawl' && installedProviderOption && credential ? (
        <div className="space-y-4">
          <WebsiteDatasourceParameterForm
            additionalPrimaryField={
              <SourceNameField
                disabled={disabled}
                draft={draft}
                preventSubmitOnEnter
                onDraftChange={updateDraft}
              />
            }
            disabled={disabled || crawlState === 'running'}
            parameters={parameters}
            schemas={parameterSchemas}
            onChange={(nextParameters) =>
              updateDraft({
                ...draft,
                parameters: nextParameters,
                rootUrl: typeof nextParameters.url === 'string' ? nextParameters.url : '',
              })
            }
          />
          {crawlState !== 'success' && (
            <Button
              type="button"
              variant="primary"
              className="w-full"
              disabled={disabled || crawlState === 'running' || !previewReady}
              onClick={() => void startPreview()}
            >
              {crawlState === 'running'
                ? t(($) => $['newKnowledge.crawling'])
                : t(($) => $['newKnowledge.crawlAndPreview'])}
            </Button>
          )}
          <section
            aria-label={t(($) => $['newKnowledge.crawlPreview'])}
            className={cn(
              crawlState === 'running'
                ? 'flex h-60 flex-col gap-3.5 overflow-hidden rounded-xl border border-divider-deep bg-background-default-subtle p-4'
                : crawlState === 'success'
                  ? ''
                  : 'min-h-40 rounded-lg border border-dashed border-divider-regular px-4 py-4',
            )}
          >
            {crawlState === 'idle' && (
              <div className="flex min-h-32 flex-col items-center justify-center text-center">
                <span className="flex size-10 items-center justify-center rounded-lg bg-background-section">
                  <span aria-hidden className="i-ri-global-line size-5 text-text-tertiary" />
                </span>
                <p className="mt-2 system-xs-semibold text-text-primary">
                  {t(($) => $['newKnowledge.pagesAppearTitle'])}
                </p>
                <p className="mt-2 system-xs-regular text-text-tertiary">
                  {t(($) => $['newKnowledge.pagesAppearDescription'])}
                </p>
              </div>
            )}
            {crawlState === 'running' && (
              <div className="flex h-6 shrink-0 items-center gap-2">
                <span
                  aria-hidden
                  className="i-ri-loader-4-line size-4 animate-spin text-text-accent"
                />
                <p
                  role="status"
                  aria-live="polite"
                  className="min-w-0 flex-1 truncate system-xs-medium text-text-primary"
                >
                  {t(($) => $['newKnowledge.crawlingPages'], {
                    count: previewPages.length,
                    host: installedProviderOption.label,
                  })}
                </p>
                <Button
                  type="button"
                  variant="ghost-accent"
                  size="small"
                  className="ml-auto shrink-0"
                  disabled={stoppingPreview}
                  loading={stoppingPreview}
                  onClick={() => void stopPreview()}
                >
                  {t(($) => $['newKnowledge.stopCrawl'])}
                </Button>
              </div>
            )}
            {crawlState === 'running' &&
              CRAWL_PREVIEW_SKELETONS.map(({ id, sourceWidth, titleWidth }) => (
                <div key={id} aria-hidden className="flex h-8 shrink-0 items-center gap-2.5 py-1">
                  <span className="size-4 animate-pulse rounded bg-util-colors-gray-gray-200 motion-reduce:animate-none" />
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span
                      className={cn(
                        'block h-2.5 animate-pulse rounded bg-util-colors-gray-gray-200 motion-reduce:animate-none',
                        titleWidth,
                      )}
                    />
                    <span
                      className={cn(
                        'block h-2 animate-pulse rounded bg-background-section-burn motion-reduce:animate-none',
                        sourceWidth,
                      )}
                    />
                  </span>
                </div>
              ))}
            {crawlState === 'error' && (
              <p role="alert" className="system-xs-regular text-text-destructive">
                {t(($) => $['newKnowledge.crawlStartFailed'])}
              </p>
            )}
            {crawlState === 'stopped' && (
              <p role="status" className="system-xs-regular text-text-secondary">
                {t(($) => $['newKnowledge.crawlStopped'])}
              </p>
            )}
            {crawlState === 'success' && (
              <CrawlPreviewPageSelection
                disabled={disabled}
                onRecrawl={() => void startPreview()}
                onSelectionChange={updateSelectedPageIds}
                pages={selectionPages}
                rootUrl={selectionRootUrl}
                selectedPageIds={selectedPageIds}
                sourceLabel={installedProviderOption.label}
              />
            )}
          </section>
          <SourceSyncPolicyField
            className="w-full sm:w-75.25"
            disabled={disabled}
            draft={draft}
            onDraftChange={updateDraftWithoutReset}
            size="medium"
          />
        </div>
      ) : draft.sourceType !== 'websiteCrawl' && installedProviderOption && credential ? (
        <CreateConnectedSourceSetup
          key={`${draft.sourceType}:${installedProviderOption.key}:${credential.id}`}
          credential={credential}
          disabled={disabled}
          draft={draft}
          providerOption={installedProviderOption}
          onDraftChange={updateDraftWithoutReset}
          onInitialSourceChange={onInitialSourceChange}
        />
      ) : null}
    </div>
  )
}
