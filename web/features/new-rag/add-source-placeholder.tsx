'use client'

import type {
  NewKnowledgeOnlineDocumentsProvider,
  NewKnowledgeOnlineDocumentsSourceDraft,
  NewKnowledgeOnlineDriveProvider,
  NewKnowledgeOnlineDriveSourceDraft,
  NewKnowledgeSourceDraft,
  NewKnowledgeWebsiteSourceDraft,
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

const connectedProviders = {
  onlineDocuments: [
    { icon: 'i-custom-public-common-notion', label: 'Notion' },
    { icon: 'i-ri-file-text-line', label: 'Google Docs' },
    { icon: 'i-ri-links-line', label: 'Confluence' },
  ],
  onlineDrive: [
    { icon: 'i-custom-public-common-google-drive', label: 'Google Drive' },
    { icon: 'i-ri-cloud-line', label: 'OneDrive' },
    { icon: 'i-ri-box-3-line', label: 'Amazon S3' },
  ],
} as const

export function PendingWebsiteSetup({
  draft,
  onDraftChange,
}: {
  draft: NewKnowledgeWebsiteSourceDraft
  onDraftChange: (draft: NewKnowledgeWebsiteSourceDraft) => void
}) {
  const { t } = useTranslation('dataset')
  const [optionsExpanded, setOptionsExpanded] = useState(false)
  const [backendBoundaryVisible, setBackendBoundaryVisible] = useState(false)
  const updateDraft = (nextDraft: NewKnowledgeWebsiteSourceDraft) => {
    onDraftChange(nextDraft)
    setBackendBoundaryVisible(false)
  }

  return (
    <section className="space-y-4" aria-label={t(($) => $['newKnowledge.crawlAndPreview'])}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block system-xs-medium text-text-secondary">
          {t(($) => $['newKnowledge.rootUrl'])}
          <input
            type="url"
            inputMode="url"
            autoComplete="off"
            maxLength={NEW_KNOWLEDGE_SOURCE_URL_MAX_LENGTH}
            value={draft.rootUrl}
            placeholder={t(($) => $['newKnowledge.rootUrlPlaceholder'])}
            className="mt-1.5 h-9 w-full rounded-lg border-0 bg-components-input-bg-normal px-3 system-sm-regular text-text-primary outline-hidden placeholder:text-text-quaternary focus:ring-2 focus:ring-state-accent-solid"
            onChange={(event) => {
              updateDraft({ ...draft, rootUrl: event.target.value })
            }}
          />
        </label>
        <label className="block system-xs-medium text-text-secondary">
          {t(($) => $['newKnowledge.sourceName'])}
          <input
            type="text"
            autoComplete="off"
            maxLength={NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH}
            value={draft.sourceName}
            placeholder={t(($) => $['newKnowledge.sourceNamePlaceholder'])}
            className="mt-1.5 h-9 w-full rounded-lg border-0 bg-components-input-bg-normal px-3 system-sm-regular text-text-primary outline-hidden placeholder:text-text-quaternary focus:ring-2 focus:ring-state-accent-solid"
            onChange={(event) => {
              updateDraft({ ...draft, sourceName: event.target.value })
            }}
          />
        </label>
      </div>
      <div className="overflow-hidden rounded-lg bg-background-section">
        <button
          type="button"
          aria-expanded={optionsExpanded}
          className="flex min-h-9 w-full items-center gap-2 px-3 text-left system-xs-medium text-text-secondary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          onClick={() => setOptionsExpanded((value) => !value)}
        >
          <span
            aria-hidden
            className={cn(
              'size-4',
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
          <fieldset className="grid grid-cols-1 gap-3 px-3 pb-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 system-xs-regular text-text-secondary">
              <input
                type="checkbox"
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
                min={1}
                max={200}
                value={draft.maxPages}
                className="mt-1.5 h-9 w-full rounded-lg border-0 bg-components-input-bg-normal px-3 system-sm-regular text-text-primary outline-hidden focus:ring-2 focus:ring-state-accent-solid"
                onChange={(event) =>
                  updateDraft({ ...draft, maxPages: event.target.valueAsNumber || 0 })
                }
              />
            </label>
          </fieldset>
        )}
      </div>
      <Button
        type="button"
        variant="primary"
        className="w-full"
        disabled={!isValidWebsiteSourceDraft(draft)}
        onClick={() => setBackendBoundaryVisible(true)}
      >
        {t(($) => $['newKnowledge.crawlAndPreview'])}
      </Button>
      <div className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-divider-regular px-6 text-center">
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
      {backendBoundaryVisible && (
        <p
          role="alert"
          className="rounded-md bg-components-badge-status-light-warning-bg px-3 py-2 system-xs-regular text-text-warning"
        >
          {t(($) => $['newKnowledge.sourceSetupBackendDependency'])}
        </p>
      )}
    </section>
  )
}

export function UnavailableConnectedSourceSetup({
  draft,
  onDraftChange,
}: {
  draft: NewKnowledgeOnlineDocumentsSourceDraft | NewKnowledgeOnlineDriveSourceDraft
  onDraftChange: (draft: NewKnowledgeSourceDraft) => void
}) {
  const { t } = useTranslation('dataset')
  const { t: tCreation } = useTranslation('datasetCreation')
  const sourceType = draft.sourceType
  const providers = connectedProviders[sourceType]
  const activeProvider = draft.provider
  const selectProvider = (provider: string) => {
    if (draft.sourceType === 'onlineDocuments')
      onDraftChange({ ...draft, provider: provider as NewKnowledgeOnlineDocumentsProvider })
    else onDraftChange({ ...draft, provider: provider as NewKnowledgeOnlineDriveProvider })
  }

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-1.5 system-xs-medium text-text-secondary">
          {tCreation(($) => $['stepOne.website.chooseProvider'])}
        </legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {providers.map((option) => (
            <label
              key={option.label}
              className={cn(
                'flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 system-xs-medium outline-hidden has-focus-visible:ring-2 has-focus-visible:ring-state-accent-solid',
                activeProvider === option.label
                  ? 'border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg text-text-primary'
                  : 'border-divider-subtle text-text-secondary hover:bg-state-base-hover',
              )}
            >
              <input
                type="radio"
                name={`${sourceType}-provider`}
                value={option.label}
                checked={activeProvider === option.label}
                onChange={() => selectProvider(option.label)}
                className="sr-only"
              />
              <span aria-hidden className={`${option.icon} size-4 shrink-0`} />
              <span className="truncate">{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {sourceType === 'onlineDrive' && (
        <section
          aria-label={t(($) => $['newKnowledge.selectFilesAndFolders'])}
          className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-divider-regular px-6 text-center"
        >
          <span className="flex size-10 items-center justify-center rounded-lg bg-background-section">
            <span aria-hidden className="i-ri-folder-open-line size-5 text-text-tertiary" />
          </span>
          <p className="mt-2 system-xs-semibold text-text-primary">
            {t(($) => $['newKnowledge.selectFilesAndFolders'])}
          </p>
        </section>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block system-xs-medium text-text-secondary">
          {t(($) => $['newKnowledge.sourceName'])}
          <span aria-hidden className="ml-0.5 text-text-destructive">
            *
          </span>
          <input
            type="text"
            autoComplete="off"
            maxLength={NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH}
            value={draft.sourceName}
            placeholder={t(($) => $['newKnowledge.sourceNamePlaceholder'])}
            className="mt-1.5 h-9 w-full rounded-lg border-0 bg-components-input-bg-normal px-3 system-sm-regular text-text-primary outline-hidden placeholder:text-text-quaternary focus:ring-2 focus:ring-state-accent-solid"
            onChange={(event) => onDraftChange({ ...draft, sourceName: event.target.value })}
          />
        </label>
        <label className="block system-xs-medium text-text-secondary">
          {t(($) => $['newKnowledge.syncPolicy'])}
          <select
            value={draft.syncPolicy}
            className="mt-1.5 h-9 w-full rounded-lg border-0 bg-components-input-bg-normal px-3 system-sm-regular text-text-primary outline-hidden focus:ring-2 focus:ring-state-accent-solid"
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

      <div role="status" className="rounded-lg bg-background-section px-3 py-2">
        <p className="system-xs-regular text-text-tertiary">
          {t(($) => $['newKnowledge.providerUnavailable'])}
        </p>
      </div>
    </div>
  )
}
