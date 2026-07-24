'use client'

import type {
  NewKnowledgeOnlineDocumentsProvider,
  NewKnowledgeOnlineDriveProvider,
  NewKnowledgeSourceDraft,
  NewKnowledgeWebsiteProvider,
} from './routes'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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

const providers = {
  onlineDocuments: [
    { icon: 'i-custom-public-common-notion', label: 'Notion' },
    { icon: 'i-ri-file-text-line', label: 'Google Docs' },
    { icon: 'i-ri-links-line', label: 'Confluence' },
  ],
  onlineDrive: [
    { icon: 'i-ri-google-drive-line', label: 'Google Drive' },
    { icon: 'i-ri-cloud-line', label: 'OneDrive' },
    { icon: 'i-ri-box-3-line', label: 'Amazon S3' },
  ],
  websiteCrawl: [
    { icon: 'i-ri-fire-fill text-orange-500', label: 'Firecrawl', available: true },
    { icon: 'i-custom-public-llm-jina', label: 'Jina Reader' },
    { icon: 'i-ri-water-flash-line', label: 'WaterCrawl' },
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
      <label className="block system-xs-medium text-text-secondary">
        {t(($) => $['newKnowledge.sourceName'])}
        <span aria-hidden className="ml-0.5 text-text-destructive">
          *
        </span>
        <input
          type="text"
          autoComplete="off"
          name="sourceName"
          disabled={disabled}
          maxLength={NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH}
          value={draft.sourceName}
          placeholder={t(($) => $['newKnowledge.sourceNamePlaceholder'])}
          className="mt-1.5 h-9 w-full rounded-lg border-0 bg-components-input-bg-normal px-3 system-sm-regular text-text-primary outline-hidden placeholder:text-text-quaternary focus:ring-2 focus:ring-state-accent-solid disabled:text-text-disabled"
          onChange={(event) => onDraftChange({ ...draft, sourceName: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.preventDefault()
          }}
        />
      </label>
      <label className="block system-xs-medium text-text-secondary">
        {t(($) => $['newKnowledge.syncPolicy'])}
        <select
          name="syncPolicy"
          disabled={disabled}
          value={draft.syncPolicy}
          className="mt-1.5 h-9 w-full rounded-lg border-0 bg-components-input-bg-normal px-3 system-sm-regular text-text-primary outline-hidden focus:ring-2 focus:ring-state-accent-solid disabled:text-text-disabled"
          onChange={(event) =>
            onDraftChange({
              ...draft,
              syncPolicy: event.target.value as NewKnowledgeSourceDraft['syncPolicy'],
            })
          }
        >
          <option value="provider">{t(($) => $['newKnowledge.syncPolicyProvider'])}</option>
          <option value="daily">{t(($) => $['newKnowledge.syncPolicyDaily'])}</option>
          <option value="manual">{t(($) => $['newKnowledge.syncPolicyManual'])}</option>
        </select>
      </label>
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
  const { t: tCreation } = useTranslation('datasetCreation')
  const [optionsExpanded, setOptionsExpanded] = useState(false)
  const [backendBoundaryVisible, setBackendBoundaryVisible] = useState(false)
  const sourceType = draft.sourceType
  const availableProviders = providers[sourceType]
  const activeProvider = availableProviders.some((provider) => provider.label === draft.provider)
    ? draft.provider
    : availableProviders[0].label
  const previewReady = draft.sourceType === 'websiteCrawl' && isValidWebsiteSourceDraft(draft)
  const showBackendBoundary = () => setBackendBoundaryVisible(true)
  const updateDraft = (nextDraft: NewKnowledgeSourceDraft) => {
    onDraftChange(nextDraft)
    setBackendBoundaryVisible(false)
  }
  const selectProvider = (provider: string) => {
    if (draft.sourceType === 'onlineDocuments')
      updateDraft({ ...draft, provider: provider as NewKnowledgeOnlineDocumentsProvider })
    else if (draft.sourceType === 'onlineDrive')
      updateDraft({ ...draft, provider: provider as NewKnowledgeOnlineDriveProvider })
    else updateDraft({ ...draft, provider: provider as NewKnowledgeWebsiteProvider })
  }

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
                onChange={() => {
                  setBackendBoundaryVisible(false)
                  onSourceTypeChange(option.value)
                }}
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
        <div className={cn('grid grid-cols-2 gap-2', 'sm:grid-cols-3')}>
          {providers[sourceType].map((provider) => {
            return (
              <label
                key={provider.label}
                className={cn(
                  'flex min-h-10 items-center gap-2 rounded-lg border bg-background-default px-3 system-xs-medium outline-hidden has-focus-visible:ring-2 has-focus-visible:ring-state-accent-solid',
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
                  onChange={() => selectProvider(provider.label)}
                  className="sr-only"
                />
                <span aria-hidden className={`${provider.icon} size-4 shrink-0`} />
                <span className="truncate">{provider.label}</span>
              </label>
            )
          })}
        </div>
      </fieldset>

      {draft.sourceType === 'websiteCrawl' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block system-xs-medium text-text-secondary">
              {t(($) => $['newKnowledge.rootUrl'])}
              <input
                type="url"
                inputMode="url"
                autoComplete="off"
                name="rootUrl"
                disabled={disabled}
                maxLength={NEW_KNOWLEDGE_SOURCE_URL_MAX_LENGTH}
                value={draft.rootUrl}
                placeholder={t(($) => $['newKnowledge.rootUrlPlaceholder'])}
                className="mt-1.5 h-9 w-full rounded-lg border-0 bg-components-input-bg-normal px-3 system-sm-regular text-text-primary outline-hidden placeholder:text-text-quaternary focus:ring-2 focus:ring-state-accent-solid disabled:text-text-disabled"
                onChange={(event) => {
                  updateDraft({ ...draft, rootUrl: event.target.value })
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.preventDefault()
                }}
              />
            </label>
            <label className="block system-xs-medium text-text-secondary">
              {t(($) => $['newKnowledge.sourceName'])}
              <input
                type="text"
                autoComplete="off"
                name="sourceName"
                disabled={disabled}
                maxLength={NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH}
                value={draft.sourceName}
                placeholder={t(($) => $['newKnowledge.sourceNamePlaceholder'])}
                className="mt-1.5 h-9 w-full rounded-lg border-0 bg-components-input-bg-normal px-3 system-sm-regular text-text-primary outline-hidden placeholder:text-text-quaternary focus:ring-2 focus:ring-state-accent-solid disabled:text-text-disabled"
                onChange={(event) => {
                  updateDraft({ ...draft, sourceName: event.target.value })
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.preventDefault()
                }}
              />
            </label>
          </div>
          <div className="overflow-hidden rounded-lg bg-background-section">
            <button
              type="button"
              aria-label={t(($) => $['newKnowledge.crawlOptions'])}
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
              {!optionsExpanded && (
                <span className="ml-auto system-xs-regular text-text-tertiary">
                  {t(($) => $['newKnowledge.usingDefaults'])}
                </span>
              )}
            </button>
            {optionsExpanded && (
              <fieldset
                disabled={disabled}
                className="grid grid-cols-1 gap-3 px-3 pb-3 sm:grid-cols-2"
              >
                <label className="flex items-center gap-2 system-xs-regular text-text-secondary">
                  <input
                    type="checkbox"
                    name="includeSubpages"
                    checked={draft.includeSubpages}
                    onChange={(event) =>
                      updateDraft({ ...draft, includeSubpages: event.target.checked })
                    }
                  />
                  {t(($) => $['newKnowledge.includeSubpages'])}
                </label>
                <label className="system-xs-medium text-text-secondary">
                  {t(($) => $['newKnowledge.maxPages'])}
                  <input
                    type="number"
                    name="maxPages"
                    min={1}
                    max={200}
                    value={draft.maxPages}
                    className="mt-1.5 h-9 w-full rounded-lg border-0 bg-components-input-bg-normal px-3 system-sm-regular text-text-primary outline-hidden focus:ring-2 focus:ring-state-accent-solid"
                    onChange={(event) =>
                      updateDraft({ ...draft, maxPages: event.target.valueAsNumber || 0 })
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.preventDefault()
                    }}
                  />
                </label>
              </fieldset>
            )}
          </div>
          <Button
            type="button"
            variant="primary"
            className="w-full"
            disabled={disabled || !previewReady}
            onClick={showBackendBoundary}
          >
            {t(($) => $['newKnowledge.crawlAndPreview'])}
          </Button>
          <section
            aria-label={t(($) => $['newKnowledge.crawlPreview'])}
            className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-divider-regular px-6 text-center"
          >
            <span className="flex size-10 items-center justify-center rounded-lg bg-background-section">
              <span aria-hidden className="i-ri-global-line size-5 text-text-tertiary" />
            </span>
            <p className="mt-2 system-xs-semibold text-text-primary">
              {t(($) => $['newKnowledge.pagesAppearTitle'])}
            </p>
            <p className="mt-2 system-xs-regular text-text-tertiary">
              {t(($) => $['newKnowledge.pagesAppearDescription'])}
            </p>
          </section>
        </div>
      )}

      {draft.sourceType !== 'websiteCrawl' && (
        <div className="space-y-3">
          {draft.sourceType === 'onlineDocuments' && activeProvider === 'Notion' && (
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
                    {t(($) => $['newKnowledge.notionNotConnected'])}
                  </p>
                  <p className="mt-1 system-xs-regular text-text-tertiary">
                    {t(($) => $['newKnowledge.notionNotConnectedDescription'])}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={disabled}
                  className="h-8 shrink-0 rounded-lg bg-components-button-primary-bg px-3 system-xs-medium text-components-button-primary-text outline-hidden hover:bg-components-button-primary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={showBackendBoundary}
                >
                  {t(($) => $['newKnowledge.connectNotion'])}
                </button>
              </div>
            </section>
          )}
          <ConnectedSourceConfiguration
            disabled={disabled}
            draft={draft}
            onDraftChange={updateDraft}
          />
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
