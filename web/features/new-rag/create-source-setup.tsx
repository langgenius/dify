'use client'

import type { NewKnowledgeSourceDraft, NewKnowledgeSourceType } from './routes'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

const sourceTypes = [
  { icon: 'i-ri-global-line', value: 'websiteCrawl' },
  { icon: 'i-ri-file-text-line', value: 'onlineDocuments' },
  { icon: 'i-ri-hard-drive-3-line', value: 'onlineDrive' },
] as const

const providers = {
  onlineDocuments: [
    { icon: 'i-custom-public-common-notion', label: 'Notion' },
    { icon: 'i-ri-file-text-line', label: 'Google Docs' },
    { icon: 'i-ri-links-line', label: 'Confluence' },
  ],
  onlineDrive: [
    { icon: 'i-ri-google-drive-line', label: 'Google Drive' },
    { icon: 'i-ri-cloud-line', label: 'Amazon S3' },
    { icon: 'i-ri-dropbox-line', label: 'Dropbox' },
  ],
  websiteCrawl: [
    { icon: 'i-ri-fire-fill text-orange-500', label: 'Firecrawl', available: true },
    { icon: 'i-custom-public-llm-jina', label: 'Jina Reader' },
    { icon: 'i-ri-water-flash-line', label: 'WaterCrawl' },
    { icon: 'i-ri-bug-line', label: 'FakeCrawler' },
  ],
} as const

function isValidRootUrl(value: string) {
  try {
    const url = new URL(value.trim())
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname)
  } catch {
    return false
  }
}

export function CreateSourceSetup({
  disabled,
  draft,
  onDraftChange,
  sourceType,
  onSourceTypeChange,
}: {
  disabled: boolean
  draft: NewKnowledgeSourceDraft
  onDraftChange: (draft: NewKnowledgeSourceDraft) => void
  sourceType: NewKnowledgeSourceType
  onSourceTypeChange: (sourceType: NewKnowledgeSourceType) => void
}) {
  const { t } = useTranslation('dataset')
  const { t: tCreation } = useTranslation('datasetCreation')
  const [optionsExpanded, setOptionsExpanded] = useState(false)
  const [backendBoundaryVisible, setBackendBoundaryVisible] = useState(false)
  const availableProviders = providers[sourceType]
  const activeProvider = availableProviders.some((provider) => provider.label === draft.provider)
    ? draft.provider
    : availableProviders[0].label
  const previewReady =
    isValidRootUrl(draft.rootUrl) &&
    draft.sourceName.trim().length > 0 &&
    draft.maxPages > 0 &&
    draft.maxPages <= 200

  const showBackendBoundary = () => setBackendBoundaryVisible(true)

  return (
    <div className="mx-4 mb-4 space-y-4 border-t border-divider-subtle pt-4">
      <fieldset disabled={disabled}>
        <legend className="mb-1.5 system-xs-medium text-text-secondary">
          {t(($) => $['newKnowledge.sourceTypeLabel'])}
        </legend>
        <div className="grid grid-cols-1 gap-0.5 rounded-lg bg-background-default p-0.5 sm:grid-cols-3">
          {sourceTypes.map((option) => (
            <label
              key={option.value}
              className={cn(
                'relative flex min-h-8 items-center justify-center gap-1.5 rounded-md px-2 system-xs-medium outline-hidden has-focus-visible:ring-2 has-focus-visible:ring-state-accent-solid',
                sourceType === option.value
                  ? 'bg-components-option-card-option-selected-bg text-text-primary shadow-xs'
                  : 'cursor-pointer text-text-tertiary hover:text-text-secondary',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type="radio"
                name="create-source-type"
                value={option.value}
                checked={sourceType === option.value}
                onChange={() => onSourceTypeChange(option.value)}
                className="sr-only"
              />
              <span aria-hidden className={`${option.icon} size-4`} />
              {t(($) => $[`newKnowledge.${option.value}`])}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset disabled={disabled}>
        <legend className="sr-only">{tCreation(($) => $['stepOne.website.chooseProvider'])}</legend>
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <span className="system-xs-medium text-text-secondary">
            {tCreation(($) => $['stepOne.website.chooseProvider'])}
          </span>
          <button
            type="button"
            disabled={disabled}
            className="rounded-sm system-xs-medium text-text-accent outline-hidden hover:text-text-accent-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:text-text-disabled"
            onClick={showBackendBoundary}
          >
            {t(($) => $['newKnowledge.moreProviders'])}
          </button>
        </div>
        <div
          className={cn(
            'grid grid-cols-2 gap-2',
            sourceType === 'websiteCrawl' ? 'sm:grid-cols-4' : 'sm:grid-cols-3',
          )}
        >
          {providers[sourceType].map((provider) => {
            return (
              <label
                key={provider.label}
                className={cn(
                  'flex min-h-10 items-center gap-2 rounded-lg border bg-background-default px-3 system-xs-medium',
                  activeProvider === provider.label
                    ? 'border-components-option-card-option-selected-border text-text-primary'
                    : 'cursor-pointer border-divider-subtle text-text-secondary hover:bg-state-base-hover',
                  disabled && 'cursor-not-allowed opacity-60',
                )}
              >
                <input
                  type="radio"
                  name="create-source-provider"
                  value={provider.label}
                  checked={activeProvider === provider.label}
                  disabled={disabled}
                  onChange={() => {
                    onDraftChange({ ...draft, provider: provider.label })
                    setBackendBoundaryVisible(false)
                  }}
                  className="sr-only"
                />
                <span aria-hidden className={`${provider.icon} size-4 shrink-0`} />
                <span className="truncate">{provider.label}</span>
              </label>
            )
          })}
        </div>
      </fieldset>

      {sourceType === 'websiteCrawl' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block system-xs-medium text-text-secondary">
              {t(($) => $['newKnowledge.rootUrl'])}
              <input
                type="url"
                inputMode="url"
                autoComplete="off"
                disabled={disabled}
                value={draft.rootUrl}
                placeholder={t(($) => $['newKnowledge.rootUrlPlaceholder'])}
                className="mt-1.5 h-9 w-full rounded-lg border-0 bg-components-input-bg-normal px-3 system-sm-regular text-text-primary outline-hidden placeholder:text-text-quaternary focus:ring-2 focus:ring-state-accent-solid disabled:text-text-disabled"
                onChange={(event) => {
                  onDraftChange({ ...draft, rootUrl: event.target.value })
                  setBackendBoundaryVisible(false)
                }}
              />
            </label>
            <label className="block system-xs-medium text-text-secondary">
              {t(($) => $['newKnowledge.sourceName'])}
              <input
                type="text"
                autoComplete="off"
                disabled={disabled}
                value={draft.sourceName}
                placeholder={t(($) => $['newKnowledge.sourceNamePlaceholder'])}
                className="mt-1.5 h-9 w-full rounded-lg border-0 bg-components-input-bg-normal px-3 system-sm-regular text-text-primary outline-hidden placeholder:text-text-quaternary focus:ring-2 focus:ring-state-accent-solid disabled:text-text-disabled"
                onChange={(event) => {
                  onDraftChange({ ...draft, sourceName: event.target.value })
                  setBackendBoundaryVisible(false)
                }}
              />
            </label>
          </div>
          <div className="overflow-hidden rounded-lg bg-background-section">
            <button
              type="button"
              aria-expanded={optionsExpanded}
              disabled={disabled}
              className="flex min-h-9 w-full items-center gap-2 px-3 text-left system-xs-medium text-text-secondary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed"
              onClick={() => setOptionsExpanded((value) => !value)}
            >
              <span
                aria-hidden
                className={cn(
                  'size-4 transition-transform motion-reduce:transition-none',
                  optionsExpanded ? 'i-ri-arrow-down-s-line' : 'i-ri-arrow-right-s-line',
                )}
              />
              {t(($) => $['newKnowledge.crawlOptions'])}
            </button>
            {optionsExpanded && (
              <fieldset
                disabled={disabled}
                className="grid grid-cols-1 gap-3 px-3 pb-3 sm:grid-cols-2"
              >
                <label className="flex items-center gap-2 system-xs-regular text-text-secondary">
                  <input
                    type="checkbox"
                    checked={draft.includeSubpages}
                    onChange={(event) =>
                      onDraftChange({ ...draft, includeSubpages: event.target.checked })
                    }
                  />
                  {t(($) => $['newKnowledge.includeSubpages'])}
                </label>
                <label className="system-xs-medium text-text-secondary">
                  {t(($) => $['newKnowledge.maxPages'])}
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={draft.maxPages}
                    className="mt-1.5 h-9 w-full rounded-lg border-0 bg-components-input-bg-normal px-3 system-sm-regular text-text-primary outline-hidden focus:ring-2 focus:ring-state-accent-solid"
                    onChange={(event) =>
                      onDraftChange({ ...draft, maxPages: event.target.valueAsNumber || 0 })
                    }
                  />
                </label>
              </fieldset>
            )}
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="primary"
              disabled={disabled || !previewReady}
              onClick={showBackendBoundary}
            >
              {t(($) => $['newKnowledge.crawlAndPreview'])}
            </Button>
          </div>
          <section
            aria-label={t(($) => $['newKnowledge.crawlPreview'])}
            className="overflow-hidden rounded-lg border border-divider-subtle bg-background-default"
          >
            <header className="flex items-center justify-between border-b border-divider-subtle px-3 py-2.5">
              <span className="system-xs-semibold text-text-primary">
                {t(($) => $['newKnowledge.crawlPreview'])}
              </span>
              <span className="inline-flex items-center gap-1.5 system-2xs-regular text-text-accent">
                <span aria-hidden className="i-ri-subtract-line size-3" />
                {t(($) => $['newKnowledge.crawlNotStarted'])}
              </span>
            </header>
            <div className="space-y-3 p-3">
              <div>
                <p className="system-xs-medium text-text-primary">
                  {t(($) => $['newKnowledge.pagesAppearTitle'])}
                </p>
                <p className="mt-0.5 system-2xs-regular text-text-tertiary">
                  {t(($) => $['newKnowledge.pagesAppearDescription'])}
                </p>
              </div>
            </div>
          </section>
        </div>
      )}

      {sourceType !== 'websiteCrawl' && (
        <div>
          <section className="rounded-lg border border-divider-subtle bg-background-default p-4">
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className={cn(
                  'mt-0.5 size-5 shrink-0',
                  availableProviders.find((provider) => provider.label === activeProvider)?.icon,
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="system-sm-semibold text-text-primary">
                  {sourceType === 'onlineDocuments' && activeProvider === 'Notion'
                    ? t(($) => $['newKnowledge.notionNotConnected'])
                    : t(($) => $['newKnowledge.providerNotConfigured'], {
                        provider: activeProvider,
                      })}
                </p>
                <p className="mt-1 system-xs-regular text-text-tertiary">
                  {sourceType === 'onlineDocuments' && activeProvider === 'Notion'
                    ? t(($) => $['newKnowledge.notionNotConnectedDescription'])
                    : t(($) => $['newKnowledge.providerUnavailable'])}
                </p>
              </div>
              <button
                type="button"
                disabled={disabled}
                className="h-8 shrink-0 rounded-lg bg-components-button-primary-bg px-3 system-xs-medium text-components-button-primary-text outline-hidden hover:bg-components-button-primary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:opacity-50"
                onClick={showBackendBoundary}
              >
                {sourceType === 'onlineDocuments' && activeProvider === 'Notion'
                  ? t(($) => $['newKnowledge.connectNotion'])
                  : t(($) => $['newKnowledge.connectProviderGeneric'])}
              </button>
            </div>
          </section>
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
