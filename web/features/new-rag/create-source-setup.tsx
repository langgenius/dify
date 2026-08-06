'use client'

import type {
  NewKnowledgeOnlineDocumentsProvider,
  NewKnowledgeOnlineDriveProvider,
  NewKnowledgeSourceDraft,
  NewKnowledgeWebsiteProvider,
} from './routes'
import type { CrawlPreviewPage } from './source-models'
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
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { checkFirecrawlTaskStatus, createFirecrawlTask } from '@/service/datasets'
import { CrawlPreviewPageSelection } from './crawl-selection-form'
import {
  isValidWebsiteSourceDraft,
  NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH,
  NEW_KNOWLEDGE_SOURCE_URL_MAX_LENGTH,
} from './routes'

const sourceTypes = [
  { icon: 'i-ri-global-line', value: 'websiteCrawl' },
  { icon: 'i-ri-file-text-line', value: 'onlineDocuments' },
  { icon: 'i-ri-hard-drive-3-line', value: 'onlineDrive' },
] as const

const DEFAULT_INCLUDE_SUBPAGES = true
const DEFAULT_MAX_PAGES = 100
const CRAWL_POLL_INTERVAL_MS = 1500

type LocalCrawlState = 'error' | 'idle' | 'running' | 'stopped' | 'success'

function crawlPages(response: Record<string, unknown>): CrawlResultItem[] {
  if (!Array.isArray(response.data)) return []
  return response.data.flatMap((item) => {
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

const providers = {
  onlineDocuments: [
    { icon: 'i-custom-public-common-notion', label: 'Notion' },
    { icon: 'i-ri-file-text-fill text-[#4d8bf5]', label: 'Google Docs' },
    { icon: 'i-custom-public-common-confluence', label: 'Confluence' },
  ],
  onlineDrive: [
    { icon: 'i-custom-public-common-google-drive', label: 'Google Drive' },
    { icon: 'i-ri-cloud-line', label: 'OneDrive' },
    { icon: 'i-ri-box-3-line', label: 'Amazon S3' },
  ],
  websiteCrawl: [
    { icon: 'i-ri-fire-fill text-orange-500', label: 'Firecrawl', available: true },
    { icon: 'i-custom-public-llm-jina', label: 'Jina Reader' },
    { icon: 'i-ri-water-flash-line', label: 'WaterCrawl' },
    { icon: 'i-ri-bug-line', label: 'FakeCrawler' },
  ],
} as const

function ConnectedSourceConfiguration({
  disabled,
  draft,
  onDraftChange,
}: {
  disabled: boolean
  draft: NewKnowledgeSourceDraft
  onDraftChange: (draft: NewKnowledgeSourceDraft) => void
}) {
  const { t } = useTranslation('dataset')

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field name="sourceName" className="gap-1.5">
        <FieldLabel>
          {t(($) => $['newKnowledge.sourceName'])}
          <span aria-hidden className="ml-0.5 text-text-destructive">
            *
          </span>
        </FieldLabel>
        <FieldControl
          type="text"
          autoComplete="off"
          disabled={disabled}
          maxLength={NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH}
          value={draft.sourceName}
          placeholder={t(($) => $['newKnowledge.sourceNamePlaceholder'])}
          size="large"
          onValueChange={(value) => onDraftChange({ ...draft, sourceName: value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.preventDefault()
          }}
        />
      </Field>
      <Select<NewKnowledgeSourceDraft['syncPolicy']>
        name="syncPolicy"
        disabled={disabled}
        value={draft.syncPolicy}
        onValueChange={(value) => {
          if (value) onDraftChange({ ...draft, syncPolicy: value })
        }}
      >
        <SelectLabel>{t(($) => $['newKnowledge.syncPolicy'])}</SelectLabel>
        <SelectTrigger size="large">
          {t(($) =>
            draft.syncPolicy === 'provider'
              ? $['newKnowledge.syncPolicyProvider']
              : draft.syncPolicy === 'daily'
                ? $['newKnowledge.syncPolicyDaily']
                : $['newKnowledge.syncPolicyManual'],
          )}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="provider">
            <SelectItemText>{t(($) => $['newKnowledge.syncPolicyProvider'])}</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
          <SelectItem value="daily">
            <SelectItemText>{t(($) => $['newKnowledge.syncPolicyDaily'])}</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
          <SelectItem value="manual">
            <SelectItemText>{t(($) => $['newKnowledge.syncPolicyManual'])}</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

export function CreateSourceSetup({
  disabled,
  draft,
  onDraftChange,
  onSourceTypeChange,
}: {
  disabled: boolean
  draft: NewKnowledgeSourceDraft
  onDraftChange: (draft: NewKnowledgeSourceDraft) => void
  onSourceTypeChange: (sourceType: NewKnowledgeSourceDraft['sourceType']) => void
}) {
  const { t } = useTranslation('dataset')
  const [optionsExpanded, setOptionsExpanded] = useState(false)
  const [backendBoundaryVisible, setBackendBoundaryVisible] = useState(false)
  const [crawlState, setCrawlState] = useState<LocalCrawlState>('idle')
  const [previewPages, setPreviewPages] = useState<CrawlResultItem[]>([])
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(() => new Set())
  const crawlAttemptRef = useRef(0)
  const pollResolveRef = useRef<(() => void) | undefined>(undefined)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const sourceType = draft.sourceType
  const availableProviders = providers[sourceType]
  const activeProvider = availableProviders.some((provider) => provider.label === draft.provider)
    ? draft.provider
    : availableProviders[0].label
  const previewReady = draft.sourceType === 'websiteCrawl' && isValidWebsiteSourceDraft(draft)
  const previewRootUrl = draft.sourceType === 'websiteCrawl' ? draft.rootUrl : ''
  const selectionPages = useMemo(() => crawlPreviewPages(previewPages), [previewPages])
  const crawlOptionsAreDefault =
    draft.sourceType !== 'websiteCrawl' ||
    (draft.includeSubpages === DEFAULT_INCLUDE_SUBPAGES && draft.maxPages === DEFAULT_MAX_PAGES)
  const showBackendBoundary = () => setBackendBoundaryVisible(true)
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
  }
  const updateDraft = (nextDraft: NewKnowledgeSourceDraft) => {
    onDraftChange(nextDraft)
    setBackendBoundaryVisible(false)
    resetPreview()
  }
  const selectProvider = (provider: string) => {
    if (draft.sourceType === 'onlineDocuments')
      updateDraft({ ...draft, provider: provider as NewKnowledgeOnlineDocumentsProvider })
    else if (draft.sourceType === 'onlineDrive')
      updateDraft({ ...draft, provider: provider as NewKnowledgeOnlineDriveProvider })
    else updateDraft({ ...draft, provider: provider as NewKnowledgeWebsiteProvider })
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
    if (draft.sourceType !== 'websiteCrawl' || !isValidWebsiteSourceDraft(draft)) return
    const attempt = crawlAttemptRef.current + 1
    crawlAttemptRef.current = attempt
    globalThis.clearTimeout(pollTimerRef.current)
    setPreviewPages([])
    setSelectedPageIds(new Set())
    setCrawlState('running')
    try {
      const created = (await createFirecrawlTask({
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
      const jobId = typeof created.job_id === 'string' ? created.job_id : undefined
      if (!jobId) throw new Error('Website crawl did not return a job id')

      while (crawlAttemptRef.current === attempt) {
        const response = (await checkFirecrawlTaskStatus(jobId)) as Record<string, unknown>
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

  return (
    <div className="mx-4 mb-4 space-y-4 border-t border-divider-subtle pt-4">
      <Fieldset disabled={disabled}>
        <FieldsetLegend className="mb-1.5 py-0 system-xs-medium">
          {t(($) => $['newKnowledge.sourceTypeLabel'])}
        </FieldsetLegend>
        <RadioGroup<NewKnowledgeSourceDraft['sourceType']>
          value={sourceType}
          disabled={disabled}
          className="grid grid-cols-1 gap-0.5 rounded-lg bg-background-default p-0.5 sm:grid-cols-3"
          onValueChange={(value) => {
            setBackendBoundaryVisible(false)
            onSourceTypeChange(value)
          }}
        >
          {sourceTypes.map((option) => (
            <RadioItem<NewKnowledgeSourceDraft['sourceType']>
              key={option.value}
              value={option.value}
              className={cn(
                'relative flex min-h-8 items-center justify-center gap-1.5 rounded-md px-2 system-xs-medium text-text-tertiary outline-hidden',
                'hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid',
                'data-checked:bg-components-option-card-option-selected-bg data-checked:text-text-primary data-checked:shadow-xs',
                'data-disabled:cursor-not-allowed data-disabled:opacity-60',
              )}
            >
              <span aria-hidden className={`${option.icon} size-4`} />
              {t(($) => $[`newKnowledge.${option.value}`])}
            </RadioItem>
          ))}
        </RadioGroup>
      </Fieldset>

      <Fieldset disabled={disabled}>
        <FieldsetLegend className="sr-only">
          {t(($) => $['newKnowledge.providerLabel'])}
        </FieldsetLegend>
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <span className="system-xs-medium text-text-secondary">
            {t(($) => $['newKnowledge.providerLabel'])}
          </span>
          <Button
            variant="ghost-accent"
            size="small"
            disabled={disabled}
            className="h-auto px-0"
            onClick={showBackendBoundary}
          >
            {t(($) => $['newKnowledge.moreProviders'])}
          </Button>
        </div>
        <RadioGroup<string>
          value={activeProvider}
          disabled={disabled}
          className={cn(
            'grid grid-cols-2 gap-2',
            sourceType === 'websiteCrawl' ? 'sm:grid-cols-4' : 'sm:grid-cols-3',
          )}
          onValueChange={selectProvider}
        >
          {providers[sourceType].map((provider) => {
            return (
              <RadioItem<string>
                key={provider.label}
                value={provider.label}
                className={cn(
                  'flex min-h-10 items-center gap-2 rounded-lg border border-divider-subtle bg-background-default px-3 system-xs-medium text-text-secondary outline-hidden',
                  'hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid',
                  'data-checked:border-components-option-card-option-selected-border data-checked:text-text-primary',
                  'data-disabled:cursor-not-allowed data-disabled:opacity-60',
                )}
              >
                <span aria-hidden className={`${provider.icon} size-4 shrink-0`} />
                <span className="truncate">{provider.label}</span>
              </RadioItem>
            )
          })}
        </RadioGroup>
      </Fieldset>

      {draft.sourceType === 'websiteCrawl' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field name="rootUrl" className="gap-1.5">
              <FieldLabel>
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
            <Field name="sourceName" className="gap-1.5">
              <FieldLabel>
                {t(($) => $['newKnowledge.sourceName'])}
                <span aria-hidden className="ml-0.5 text-text-destructive">
                  *
                </span>
              </FieldLabel>
              <FieldControl
                type="text"
                autoComplete="off"
                disabled={disabled}
                maxLength={NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH}
                value={draft.sourceName}
                placeholder={t(($) => $['newKnowledge.sourceNamePlaceholder'])}
                size="large"
                onValueChange={(value) => {
                  updateDraft({ ...draft, sourceName: value })
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.preventDefault()
                }}
              />
            </Field>
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
          <section
            aria-label={t(($) => $['newKnowledge.crawlPreview'])}
            className="min-h-40 rounded-lg border border-dashed border-divider-regular px-4 py-4"
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
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="i-ri-loader-4-line size-4 animate-spin text-text-accent"
                />
                <p role="status" className="min-w-0 flex-1 system-xs-medium text-text-primary">
                  {t(($) => $['newKnowledge.crawlingPages'], {
                    count: previewPages.length,
                    host: new URL(draft.rootUrl).host,
                  })}
                </p>
                <Button type="button" size="small" onClick={() => stopPreview()}>
                  {t(($) => $['newKnowledge.stopCrawl'])}
                </Button>
              </div>
            )}
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
                onSelectionChange={setSelectedPageIds}
                pages={selectionPages}
                rootUrl={previewRootUrl}
                selectedPageIds={selectedPageIds}
              />
            )}
          </section>
        </div>
      )}

      {draft.sourceType !== 'websiteCrawl' && (
        <div className="space-y-3">
          {draft.sourceType === 'onlineDocuments' && activeProvider === 'Notion' && (
            <section className="rounded-lg border border-divider-subtle bg-background-default p-4">
              <div className="flex flex-col items-start gap-3">
                <span
                  aria-hidden
                  className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-lg bg-background-section text-xl',
                    availableProviders.find((provider) => provider.label === activeProvider)?.icon,
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="system-sm-semibold text-text-primary">
                    {t(($) => $['newKnowledge.notionNotConnected'])}
                  </p>
                  <p className="mt-1 system-xs-regular text-text-tertiary">
                    {t(($) => $['newKnowledge.notionNotConnectedDescription'])}
                  </p>
                </div>
              </div>
              <Button
                variant="primary"
                disabled={disabled}
                className="mt-4"
                onClick={showBackendBoundary}
              >
                {t(($) => $['newKnowledge.connectNotion'])}
              </Button>
            </section>
          )}
          {!(draft.sourceType === 'onlineDocuments' && activeProvider === 'Notion') && (
            <ConnectedSourceConfiguration
              disabled={disabled}
              draft={draft}
              onDraftChange={updateDraft}
            />
          )}
        </div>
      )}

      {backendBoundaryVisible && (
        <p
          role="alert"
          className="rounded-md bg-components-badge-status-light-warning-bg px-3 py-2 system-xs-regular text-text-warning"
        >
          {t(($) => $['newKnowledge.sourceSetupBackendDependency'])}
        </p>
      )}
    </div>
  )
}
