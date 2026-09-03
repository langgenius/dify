'use client'

import type { KnowledgeFsSpaceCreatePayload } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { NewKnowledgeSourceDraft } from '../sources/setup/source-draft'
import type { CrawlPreviewPage } from '../sources/source-models'
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
import { ConnectedSourceConfiguration } from '../sources/setup/connected-source-configuration'
import { CrawlPreviewPageSelection } from '../sources/setup/crawl-selection'
import { WebsiteDatasourceParameterForm } from '../sources/setup/datasource-parameter-form'
import {
  datasourceIncludeSubpages,
  invalidDatasourceParameters,
  missingRequiredDatasourceParameters,
  websiteDatasourceParameterSchemas,
  withDatasourceParameterDefaults,
} from '../sources/setup/datasource-parameter-model'
import {
  SourceNameField,
  SourceProviderCredentialRequiredCard,
  SourceProviderEmptyState,
  SourceProviderIcon,
  SourceProviderRadioGroup,
  SourceSyncPolicyField,
  SourceTypeSelector,
} from '../sources/setup/fields'
import {
  discoverSourceProviderOptions,
  sourceDraftForProviderOption,
  sourceProviderOptionForDraft,
} from '../sources/setup/provider-options'

const CRAWL_PREVIEW_SKELETONS = [
  { id: 'short', sourceWidth: 'w-22.5', titleWidth: 'w-37.5' },
  { id: 'medium', sourceWidth: 'w-26', titleWidth: 'w-42.5' },
  { id: 'long', sourceWidth: 'w-29.5', titleWidth: 'w-47.5' },
  { id: 'longest', sourceWidth: 'w-33', titleWidth: 'w-52.5' },
] as const
const CRAWL_POLL_INTERVAL_MS = 1500

type LocalCrawlState = 'error' | 'idle' | 'running' | 'stopped' | 'success'
type InitialSource = NonNullable<KnowledgeFsSpaceCreatePayload['initial_source']>
type CreateSourceSetupProps = {
  disabled: boolean
  draft: NewKnowledgeSourceDraft
  onDraftChange: (draft: NewKnowledgeSourceDraft) => void
  onInitialSourceChange: (source?: InitialSource) => void
  onSourceTypeChange: (sourceType: NewKnowledgeSourceDraft['sourceType']) => void
}

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

export function CreateSourceSetup(props: CreateSourceSetupProps) {
  const { disabled, draft, onDraftChange, onSourceTypeChange } = props
  const { t } = useTranslation('knowledgeSpace')
  const datasourcePluginsQuery = useDataSourceList(true)
  const datasourceAuthQuery = useGetDataSourceListAuth()
  const providerOptions = useMemo(
    () => discoverSourceProviderOptions(draft.sourceType, datasourcePluginsQuery.data ?? []),
    [datasourcePluginsQuery.data, draft.sourceType],
  )
  const providerOption = sourceProviderOptionForDraft(providerOptions, draft)
  const providerDraft = useMemo(
    () => (providerOption ? sourceDraftForProviderOption(draft, providerOption) : draft),
    [draft, providerOption],
  )
  const datasourceAuth = providerOption
    ? datasourceAuthForProvider(
        datasourceAuthQuery.data?.result ?? [],
        providerOption.plugin.plugin_id,
        providerOption.plugin.provider,
      )
    : undefined
  const credential = preferredCredential(datasourceAuth)
  const sessionKey = [
    draft.sourceType,
    providerOption?.key ?? 'no-provider',
    providerOption?.plugin.plugin_unique_identifier ?? 'no-plugin-version',
    credential?.id ?? 'no-credential',
  ].join(':')

  const selectProvider = (providerKey: string) => {
    const nextProvider = providerOptions.find((option) => option.key === providerKey)
    if (!nextProvider) return
    onDraftChange(sourceDraftForProviderOption(providerDraft, nextProvider))
  }

  return (
    <div className="mx-4 -mt-1 mb-3.75 flex flex-col gap-4">
      <SourceTypeSelector
        appearance="embedded"
        disabled={disabled}
        value={draft.sourceType}
        onChange={onSourceTypeChange}
      />

      <Fieldset disabled={disabled}>
        <FieldsetLegend className="sr-only">{t(($) => $.providerLabel)}</FieldsetLegend>
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <span className="system-xs-medium text-text-secondary">{t(($) => $.providerLabel)}</span>
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
            {t(($) => $.moreProviders)}
            <span aria-hidden className="i-ri-arrow-right-up-line size-3.5" />
          </Button>
        </div>
        {providerOptions.length > 0 ? (
          <SourceProviderRadioGroup
            value={providerOption?.key ?? ''}
            disabled={disabled}
            layout={draft.sourceType === 'websiteCrawl' ? 'grid-four' : 'grid-three'}
            options={providerOptions.map((option) => ({
              icon: (
                <SourceProviderIcon
                  fallbackIcon={option.fallbackIcon}
                  icon={option.datasource.identity.icon ?? option.plugin.declaration.identity.icon}
                />
              ),
              label: option.label,
              value: option.key,
            }))}
            surface="default"
            onChange={selectProvider}
          />
        ) : !datasourcePluginsQuery.isPending && !datasourcePluginsQuery.error ? (
          <SourceProviderEmptyState className="min-h-16" />
        ) : null}
      </Fieldset>

      <CreateSourceSetupSession key={sessionKey} {...props} />
    </div>
  )
}

function CreateSourceSetupSession({
  disabled,
  draft,
  onDraftChange,
  onInitialSourceChange,
}: CreateSourceSetupProps) {
  const { t } = useTranslation('knowledgeSpace')
  const datasourcePluginsQuery = useDataSourceList(true)
  const datasourceAuthQuery = useGetDataSourceListAuth()
  const [crawlState, setCrawlState] = useState<LocalCrawlState>('idle')
  const [stoppingPreview, setStoppingPreview] = useState(false)
  const [previewPages, setPreviewPages] = useState<CrawlPreviewPage[]>([])
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(() => new Set())
  const crawlAttemptRef = useRef(0)
  const previewJobIdRef = useRef<string | undefined>(undefined)
  const previewFingerprintRef = useRef<string | undefined>(undefined)
  const providerOptions = useMemo(
    () => discoverSourceProviderOptions(draft.sourceType, datasourcePluginsQuery.data ?? []),
    [datasourcePluginsQuery.data, draft.sourceType],
  )
  const providerOption = sourceProviderOptionForDraft(providerOptions, draft)
  const providerDraft = useMemo(
    () => (providerOption ? sourceDraftForProviderOption(draft, providerOption) : draft),
    [draft, providerOption],
  )
  const installedProviderOption = providerOption
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
    const current = withDatasourceParameterDefaults(parameterSchemas, providerDraft.parameters)
    if (
      providerDraft.sourceType === 'websiteCrawl' &&
      providerDraft.rootUrl &&
      parameterSchemas.some((parameter) => parameter.name === 'url') &&
      current.url === undefined
    )
      current.url = providerDraft.rootUrl
    return current
  }, [parameterSchemas, providerDraft])
  const parametersValid =
    !missingRequiredDatasourceParameters(parameterSchemas, parameters).length &&
    !invalidDatasourceParameters(parameterSchemas, parameters).length
  const selectionPages = previewPages
  const previewReady = Boolean(
    providerDraft.sourceType === 'websiteCrawl' &&
    credential &&
    installedProviderOption &&
    parametersValid &&
    providerDraft.sourceName.trim(),
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
    previewFingerprintRef.current = undefined
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
        setPreviewPages(
          (response.result.pages ?? []).map((page) => ({
            description: page.description ?? undefined,
            pageId: page.source_url,
            sourceUrl: page.source_url,
            title: page.title ?? page.source_url,
          })),
        )
        previewFingerprintRef.current = response.result.configuration_fingerprint ?? undefined
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
      onInitialSourceChange(undefined)
    },
    [onInitialSourceChange],
  )

  const startPreview = async () => {
    if (
      providerDraft.sourceType !== 'websiteCrawl' ||
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
      if (response.status !== 'completed' || !response.result) {
        previewJobIdRef.current = undefined
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
      previewFingerprintRef.current = response.result.configuration_fingerprint ?? undefined
      setCrawlState('success')
    } catch {
      if (crawlAttemptRef.current === attempt) {
        const jobId = previewJobIdRef.current
        previewJobIdRef.current = undefined
        previewFingerprintRef.current = undefined
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
    if (providerDraft.sourceType !== 'websiteCrawl') {
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
      name: providerDraft.sourceName.trim(),
      pluginId: installedProviderOption.plugin.plugin_id,
      provider: installedProviderOption.plugin.provider,
      providerDisplayName: installedProviderOption.label,
      parameters,
      ...(previewJobIdRef.current ? { previewJobId: previewJobIdRef.current } : {}),
      ...(previewFingerprintRef.current
        ? { previewConfigurationFingerprint: previewFingerprintRef.current }
        : {}),
      root_url: sourceUri,
      selection: selectedPages.map((page) => ({
        source_url: page.sourceUrl,
        ...(page.title ? { title: page.title } : {}),
      })),
      ...(providerDraft.syncPolicy === 'custom' && providerDraft.customIntervalSeconds
        ? { custom_interval_seconds: providerDraft.customIntervalSeconds }
        : {}),
      sync_policy: providerDraft.syncPolicy,
    })
  }, [
    crawlState,
    credential,
    installedProviderOption,
    onInitialSourceChange,
    parameters,
    providerDraft,
    selectedPageIds,
    selectionPages,
    sourceUri,
  ])

  return (
    <>
      {datasourcePluginsQuery.isPending || datasourceAuthQuery.isPending ? (
        <div className="flex min-h-44 items-center justify-center">
          <span aria-hidden className="i-ri-loader-4-line size-5 animate-spin text-text-tertiary" />
        </div>
      ) : datasourcePluginsQuery.error || datasourceAuthQuery.error ? (
        <div className="rounded-xl bg-background-section p-4">
          <p className="system-sm-semibold text-text-primary">{t(($) => $.providerLoadFailed)}</p>
          <Button
            className="mt-3"
            onClick={() =>
              void Promise.all([datasourcePluginsQuery.refetch(), datasourceAuthQuery.refetch()])
            }
          >
            {t(($) => $.retryProviderLoad)}
          </Button>
        </div>
      ) : installedProviderOption && !credential ? (
        <SourceProviderCredentialRequiredCard
          disabled={disabled}
          icon={
            <SourceProviderIcon
              fallbackIcon={installedProviderOption.fallbackIcon}
              icon={
                installedProviderOption.datasource.identity.icon ??
                installedProviderOption.plugin.declaration.identity.icon
              }
            />
          }
          provider={installedProviderOption.label}
          onConnect={() =>
            globalThis.open(
              providerIntegrationPath(installedProviderOption.packageId),
              '_blank',
              'noopener,noreferrer',
            )
          }
        />
      ) : providerDraft.sourceType === 'websiteCrawl' && installedProviderOption && credential ? (
        <div className="space-y-4">
          <WebsiteDatasourceParameterForm
            additionalPrimaryField={
              <SourceNameField
                disabled={disabled}
                draft={providerDraft}
                preventSubmitOnEnter
                onDraftChange={updateDraft}
              />
            }
            disabled={disabled || crawlState === 'running'}
            parameters={parameters}
            schemas={parameterSchemas}
            onChange={(nextParameters) =>
              updateDraft({
                ...providerDraft,
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
              {crawlState === 'running' ? t(($) => $.crawling) : t(($) => $.crawlAndPreview)}
            </Button>
          )}
          <section
            aria-label={t(($) => $.crawlPreview)}
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
                  {t(($) => $.pagesAppearTitle)}
                </p>
                <p className="mt-2 system-xs-regular text-text-tertiary">
                  {t(($) => $.pagesAppearDescription)}
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
                  {t(($) => $.crawlingPages, {
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
                  {t(($) => $.stopCrawl)}
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
                {t(($) => $.crawlStartFailed)}
              </p>
            )}
            {crawlState === 'stopped' && (
              <p role="status" className="system-xs-regular text-text-secondary">
                {t(($) => $.crawlStopped)}
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
            draft={providerDraft}
            onDraftChange={updateDraftWithoutReset}
            size="medium"
          />
        </div>
      ) : providerDraft.sourceType !== 'websiteCrawl' && installedProviderOption && credential ? (
        <ConnectedSourceConfiguration
          key={`${providerDraft.sourceType}:${installedProviderOption.key}:${credential.id}`}
          disabled={disabled}
          draft={providerDraft}
          previewBinding={{
            credentialId: credential.id,
            datasource: installedProviderOption.datasource.identity.name,
            pluginId: installedProviderOption.plugin.plugin_id,
            provider: installedProviderOption.plugin.provider,
            providerDisplayName: installedProviderOption.label,
          }}
          providerOption={installedProviderOption}
          onDraftChange={updateDraftWithoutReset}
          onInitialSourceChange={onInitialSourceChange}
        />
      ) : null}
    </>
  )
}
