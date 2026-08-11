'use client'

import type { KnowledgeFsSpaceCreatePayload } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { NewKnowledgeSourceDraft } from './routes'
import type { CrawlPreviewPage } from './source-models'
import type {
  DataSourceAuth,
  DataSourceCredential,
} from '@/app/components/header/account-setting/data-source-page-new/types'
import type { CrawlResultItem } from '@/models/datasets'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'
import { Field, FieldControl, FieldLabel } from '@langgenius/dify-ui/field'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import {
  NumberField,
  NumberFieldControls,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from '@langgenius/dify-ui/number-field'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { buildIntegrationPath } from '@/app/components/integrations/routes'
import {
  checkFirecrawlTaskStatus,
  checkJinaReaderTaskStatus,
  checkWatercrawlTaskStatus,
  createFirecrawlTask,
  createJinaReaderTask,
  createWatercrawlTask,
} from '@/service/datasets'
import { useGetDataSourceListAuth } from '@/service/use-datasource'
import { useDataSourceList } from '@/service/use-pipeline'
import { CrawlPreviewPageSelection } from './crawl-selection-form'
import { CreateConnectedSourceSetup } from './create-connected-source-setup'
import { isValidWebsiteSourceDraft, NEW_KNOWLEDGE_SOURCE_URL_MAX_LENGTH } from './routes'
import {
  discoverSourceProviderOptions,
  normalizeSourceProviderName,
  sourceProviderOptionForDraft,
} from './source-provider-options'
import {
  SourceConnectionRequiredCard,
  SourceNameField,
  SourceProviderNotInstalledCard,
  SourceProviderRadioGroup,
  SourceSyncPolicyField,
  SourceTypeSelector,
} from './source-setup-fields'

const DEFAULT_INCLUDE_SUBPAGES = true
const DEFAULT_MAX_PAGES = 100
const CRAWL_POLL_INTERVAL_MS = 1500
const CRAWL_PREVIEW_SKELETONS = [
  { id: 'short', sourceWidth: 'w-22.5', titleWidth: 'w-37.5' },
  { id: 'medium', sourceWidth: 'w-26', titleWidth: 'w-42.5' },
  { id: 'long', sourceWidth: 'w-29.5', titleWidth: 'w-47.5' },
  { id: 'longest', sourceWidth: 'w-33', titleWidth: 'w-52.5' },
] as const

type LocalCrawlState = 'error' | 'idle' | 'running' | 'stopped' | 'success'
type InitialSource = NonNullable<KnowledgeFsSpaceCreatePayload['initial_source']>

function crawlPages(response: Record<string, unknown>): CrawlResultItem[] {
  const items = Array.isArray(response.data)
    ? response.data
    : response.data && typeof response.data === 'object'
      ? [response.data]
      : []
  return items.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const page = item as Record<string, unknown>
    const sourceUrl =
      typeof page.source_url === 'string'
        ? page.source_url
        : typeof page.url === 'string'
          ? page.url
          : ''
    if (!sourceUrl) return []
    return [
      {
        description: typeof page.description === 'string' ? page.description : '',
        markdown:
          typeof page.markdown === 'string'
            ? page.markdown
            : typeof page.content === 'string'
              ? page.content
              : '',
        source_url: sourceUrl,
        title: typeof page.title === 'string' ? page.title : sourceUrl,
      },
    ]
  })
}

function crawlPreviewPages(pages: CrawlResultItem[]): CrawlPreviewPage[] {
  return pages.map((page) => ({
    description: page.description,
    pageId: page.source_url,
    sourceUrl: page.source_url,
    title: page.title,
  }))
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

function websiteProviderTransport(provider: string) {
  const normalized = normalizeSourceProviderName(provider)
  if (normalized.includes('firecrawl'))
    return { check: checkFirecrawlTaskStatus, create: createFirecrawlTask }
  if (normalized.includes('jinareader') || normalized === 'jina')
    return { check: checkJinaReaderTaskStatus, create: createJinaReaderTask }
  if (normalized.includes('watercrawl'))
    return { check: checkWatercrawlTaskStatus, create: createWatercrawlTask }
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
  const [optionsExpanded, setOptionsExpanded] = useState(false)
  const [crawlState, setCrawlState] = useState<LocalCrawlState>('idle')
  const [previewPages, setPreviewPages] = useState<CrawlResultItem[]>([])
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(() => new Set())
  const crawlAttemptRef = useRef(0)
  const pollResolveRef = useRef<(() => void) | undefined>(undefined)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
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
  const websiteTransport =
    draft.sourceType === 'websiteCrawl' && installedProviderOption
      ? websiteProviderTransport(installedProviderOption.plugin.provider)
      : undefined
  const previewReady = Boolean(
    websiteTransport &&
    credential &&
    draft.sourceType === 'websiteCrawl' &&
    isValidWebsiteSourceDraft(draft),
  )
  const previewRootUrl = draft.sourceType === 'websiteCrawl' ? draft.rootUrl : ''
  const selectionPages = useMemo(() => crawlPreviewPages(previewPages), [previewPages])
  const crawlOptionsAreDefault =
    draft.sourceType !== 'websiteCrawl' ||
    (draft.includeSubpages === DEFAULT_INCLUDE_SUBPAGES && draft.maxPages === DEFAULT_MAX_PAGES)
  const stopPreview = (state: LocalCrawlState = 'stopped') => {
    crawlAttemptRef.current += 1
    globalThis.clearTimeout(pollTimerRef.current)
    pollTimerRef.current = undefined
    pollResolveRef.current?.()
    pollResolveRef.current = undefined
    setCrawlState(state)
  }
  const resetPreview = () => {
    stopPreview('idle')
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
      provider: nextProvider.label,
      providerKey: nextProvider.key,
      sourceName: '',
      ...(draft.sourceType === 'onlineDrive' &&
      nextProvider.label === 'Amazon S3' &&
      draft.syncPolicy === 'provider'
        ? { syncPolicy: 'daily' as const }
        : {}),
    })
  }

  useEffect(
    () => () => {
      crawlAttemptRef.current += 1
      globalThis.clearTimeout(pollTimerRef.current)
      pollResolveRef.current?.()
    },
    [],
  )

  const startPreview = async () => {
    if (
      draft.sourceType !== 'websiteCrawl' ||
      !isValidWebsiteSourceDraft(draft) ||
      !websiteTransport ||
      !credential ||
      !installedProviderOption
    )
      return
    const attempt = crawlAttemptRef.current + 1
    crawlAttemptRef.current = attempt
    globalThis.clearTimeout(pollTimerRef.current)
    setPreviewPages([])
    setSelectedPageIds(new Set())
    setCrawlState('running')
    try {
      const created = (await websiteTransport.create({
        options: {
          crawl_sub_pages: draft.includeSubpages,
          excludes: '',
          includes: '',
          limit: draft.maxPages,
          max_depth: '',
          only_main_content: true,
          use_sitemap: true,
        },
        url: draft.rootUrl,
      })) as Record<string, unknown>
      const synchronousPages = crawlPages(created)
      if (synchronousPages.length) {
        setPreviewPages(synchronousPages)
        setCrawlState('success')
        return
      }
      const jobId = typeof created.job_id === 'string' ? created.job_id : undefined
      if (!jobId) throw new Error('Website crawl did not return a job id')

      while (crawlAttemptRef.current === attempt) {
        const response = (await websiteTransport.check(jobId)) as Record<string, unknown>
        if (crawlAttemptRef.current !== attempt) return
        setPreviewPages(crawlPages(response))
        if (response.status === 'completed') {
          setCrawlState('success')
          return
        }
        if (response.status === 'error' || !response.status) {
          setCrawlState('error')
          return
        }
        await new Promise<void>((resolve) => {
          pollResolveRef.current = resolve
          pollTimerRef.current = globalThis.setTimeout(() => {
            pollResolveRef.current = undefined
            resolve()
          }, CRAWL_POLL_INTERVAL_MS)
        })
      }
    } catch {
      if (crawlAttemptRef.current === attempt) setCrawlState('error')
    }
  }

  const updateSelectedPageIds = (pageIds: Set<string>) => {
    setSelectedPageIds(pageIds)
  }

  useEffect(() => {
    if (
      draft.sourceType !== 'websiteCrawl' ||
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
        include_subpages: draft.includeSubpages,
        limit: draft.maxPages,
      },
      credentialId: credential.id,
      datasource: installedProviderOption.datasource.identity.name,
      kind: 'website_crawl',
      name: draft.sourceName.trim(),
      pluginId: installedProviderOption.plugin.plugin_id,
      provider: installedProviderOption.plugin.provider,
      providerDisplayName: installedProviderOption.label,
      root_url: draft.rootUrl,
      selection: selectedPages.map((page) => ({
        source_url: page.sourceUrl,
        ...(page.title ? { title: page.title } : {}),
      })),
      sync_policy: draft.syncPolicy,
    })
  }, [
    crawlState,
    credential,
    draft,
    installedProviderOption,
    onInitialSourceChange,
    selectedPageIds,
    selectionPages,
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
            icon: <span aria-hidden className={`${option.fallbackIcon} size-4 shrink-0`} />,
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
          icon={<span aria-hidden className={`${providerOption.fallbackIcon} size-4.5`} />}
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
        <SourceConnectionRequiredCard
          actionLabel={t(($) => $['newKnowledge.connectProvider'], {
            provider: installedProviderOption.label,
          })}
          description={t(($) => $['newKnowledge.providerCredentialRequiredDescription'], {
            provider: installedProviderOption.label,
          })}
          disabled={disabled}
          icon={<span aria-hidden className={`${installedProviderOption.fallbackIcon} size-4.5`} />}
          title={t(($) => $['newKnowledge.providerNotConfigured'], {
            provider: installedProviderOption.label,
          })}
          onConnect={() =>
            globalThis.open(
              providerIntegrationPath(installedProviderOption.packageId),
              '_blank',
              'noopener,noreferrer',
            )
          }
        />
      ) : draft.sourceType === 'websiteCrawl' &&
        installedProviderOption &&
        credential &&
        !websiteTransport ? (
        <div className="rounded-xl bg-background-section p-4">
          <p className="system-sm-semibold text-text-primary">{installedProviderOption.label}</p>
          <p className="mt-1 system-xs-regular text-text-tertiary">
            {t(($) => $['newKnowledge.providerUnavailable'])}
          </p>
        </div>
      ) : draft.sourceType === 'websiteCrawl' && installedProviderOption && credential ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field name="rootUrl" className="gap-1.5">
              <FieldLabel className="py-0.5">
                {t(($) => $['newKnowledge.rootUrl'])}
                <span aria-hidden className="ml-0.5 text-text-destructive">
                  *
                </span>
              </FieldLabel>
              <FieldControl
                type="url"
                inputMode="url"
                autoComplete="off"
                disabled={disabled}
                maxLength={NEW_KNOWLEDGE_SOURCE_URL_MAX_LENGTH}
                value={draft.rootUrl}
                placeholder={t(($) => $['newKnowledge.rootUrlPlaceholder'])}
                size="large"
                onValueChange={(value) => {
                  updateDraft({ ...draft, rootUrl: value })
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.preventDefault()
                }}
              />
            </Field>
            <SourceNameField
              disabled={disabled}
              draft={draft}
              labelClassName="py-0.5"
              preventSubmitOnEnter
              size="large"
              onDraftChange={updateDraft}
            />
          </div>
          <Collapsible
            open={optionsExpanded}
            onOpenChange={setOptionsExpanded}
            className="overflow-hidden rounded-lg bg-background-section"
          >
            <CollapsibleTrigger
              aria-label={t(($) => $['newKnowledge.crawlOptions'])}
              disabled={disabled}
              className="min-h-9 justify-start px-3 system-xs-medium"
            >
              <span
                aria-hidden
                className="i-ri-arrow-right-s-line size-4 transition-transform group-data-panel-open:rotate-90 motion-reduce:transition-none"
              />
              {t(($) => $['newKnowledge.crawlOptions'])}
              {!optionsExpanded && (
                <span className="ml-auto system-xs-regular text-text-tertiary">
                  {crawlOptionsAreDefault
                    ? t(($) => $['newKnowledge.usingDefaults'])
                    : `${t(($) => $['newKnowledge.includeSubpages'])}: ${t(($) =>
                        draft.includeSubpages
                          ? $['newKnowledge.booleanTrue']
                          : $['newKnowledge.booleanFalse'],
                      )} · ${t(($) => $['newKnowledge.maxPages'])}: ${draft.maxPages}`}
                </span>
              )}
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <Fieldset
                disabled={disabled}
                className="grid grid-cols-1 gap-3 px-3 pb-3 sm:grid-cols-2"
              >
                <label className="flex items-center gap-2 system-xs-regular text-text-secondary">
                  <Checkbox
                    name="includeSubpages"
                    checked={draft.includeSubpages}
                    disabled={disabled}
                    onCheckedChange={(checked) =>
                      updateDraft({ ...draft, includeSubpages: checked })
                    }
                  />
                  {t(($) => $['newKnowledge.includeSubpages'])}
                </label>
                <div>
                  <span className="system-xs-medium text-text-secondary">
                    {t(($) => $['newKnowledge.maxPages'])}
                  </span>
                  <NumberField
                    disabled={disabled}
                    name="maxPages"
                    min={1}
                    max={200}
                    value={draft.maxPages}
                    onValueChange={(value) => updateDraft({ ...draft, maxPages: value ?? 0 })}
                  >
                    <NumberFieldGroup className="mt-1.5">
                      <NumberFieldInput
                        aria-label={t(($) => $['newKnowledge.maxPages'])}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.preventDefault()
                        }}
                      />
                      <NumberFieldControls>
                        <NumberFieldIncrement />
                        <NumberFieldDecrement />
                      </NumberFieldControls>
                    </NumberFieldGroup>
                  </NumberField>
                </div>
              </Fieldset>
            </CollapsiblePanel>
          </Collapsible>
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
                    host: new URL(draft.rootUrl).host,
                  })}
                </p>
                <Button
                  type="button"
                  variant="ghost-accent"
                  size="small"
                  className="ml-auto shrink-0"
                  onClick={() => stopPreview()}
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
                rootUrl={previewRootUrl}
                selectedPageIds={selectedPageIds}
              />
            )}
          </section>
          {crawlState === 'success' && (
            <SourceSyncPolicyField
              className="w-full sm:w-75.25"
              disabled={disabled}
              draft={draft}
              onDraftChange={updateDraftWithoutReset}
              size="medium"
            />
          )}
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
