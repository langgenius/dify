'use client'

import type { NewKnowledgeSourceType } from './routes'
import { cn } from '@langgenius/dify-ui/cn'
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

function DisabledField({ label, placeholder }: { label: string; placeholder: string }) {
  return (
    <label className="block system-xs-medium text-text-secondary">
      {label}
      <input
        type="text"
        disabled
        placeholder={placeholder}
        className="mt-1.5 h-9 w-full rounded-lg border-0 bg-components-input-bg-normal px-3 text-text-disabled"
      />
    </label>
  )
}

export function CreateSourceSetup({
  disabled,
  sourceType,
  onSourceTypeChange,
}: {
  disabled: boolean
  sourceType: NewKnowledgeSourceType
  onSourceTypeChange: (sourceType: NewKnowledgeSourceType) => void
}) {
  const { t } = useTranslation('dataset')
  const { t: tCreation } = useTranslation('datasetCreation')

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
            disabled
            className="cursor-not-allowed system-xs-medium text-text-disabled"
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
          {providers[sourceType].map((provider, index) => {
            const available = 'available' in provider && provider.available
            return (
              <label
                key={provider.label}
                className={cn(
                  'flex min-h-10 items-center gap-2 rounded-lg border bg-background-default px-3 system-xs-medium',
                  available
                    ? 'border-components-option-card-option-selected-border text-text-primary'
                    : 'cursor-not-allowed border-divider-subtle text-text-disabled',
                )}
              >
                <input
                  type="radio"
                  name="create-source-provider"
                  value={provider.label}
                  checked={available && index === 0}
                  disabled={!available || disabled}
                  readOnly
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
            <DisabledField
              label={t(($) => $['newKnowledge.rootUrl'])}
              placeholder={t(($) => $['newKnowledge.rootUrlPlaceholder'])}
            />
            <DisabledField
              label={t(($) => $['newKnowledge.sourceName'])}
              placeholder={t(($) => $['newKnowledge.sourceNamePlaceholder'])}
            />
          </div>
          <fieldset disabled className="rounded-lg bg-background-section p-3">
            <legend className="px-1 system-xs-medium text-text-secondary">
              {t(($) => $['newKnowledge.crawlOptions'])}
            </legend>
            <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 system-xs-regular text-text-disabled">
                <input type="checkbox" disabled />
                {t(($) => $['newKnowledge.includeSubpages'])}
              </label>
              <label className="system-xs-medium text-text-secondary">
                {t(($) => $['newKnowledge.maxPages'])}
                <input
                  type="number"
                  disabled
                  value={50}
                  readOnly
                  className="mt-1.5 h-9 w-full rounded-lg border-0 bg-components-input-bg-disabled px-3 text-text-disabled"
                />
              </label>
            </div>
          </fieldset>
          <div className="flex justify-end">
            <button
              type="button"
              disabled
              className="h-8 cursor-not-allowed rounded-lg bg-components-button-primary-bg px-3.5 system-sm-medium text-components-button-primary-text opacity-50"
            >
              {t(($) => $['newKnowledge.crawlAndPreview'])}
            </button>
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
                  sourceType === 'onlineDocuments'
                    ? 'i-custom-public-common-notion'
                    : 'i-ri-google-drive-line',
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="system-sm-semibold text-text-primary">
                  {sourceType === 'onlineDocuments'
                    ? t(($) => $['newKnowledge.notionNotConnected'])
                    : t(($) => $['newKnowledge.providerNotConfigured'], {
                        provider: 'Google Drive',
                      })}
                </p>
                <p className="mt-1 system-xs-regular text-text-tertiary">
                  {sourceType === 'onlineDocuments'
                    ? t(($) => $['newKnowledge.notionNotConnectedDescription'])
                    : t(($) => $['newKnowledge.providerUnavailable'])}
                </p>
              </div>
              <button
                type="button"
                disabled
                className="h-8 shrink-0 cursor-not-allowed rounded-lg bg-components-button-primary-bg px-3 system-xs-medium text-components-button-primary-text opacity-50"
              >
                {sourceType === 'onlineDocuments'
                  ? t(($) => $['newKnowledge.connectNotion'])
                  : t(($) => $['newKnowledge.connectProviderGeneric'])}
              </button>
            </div>
          </section>
        </div>
      )}

      <p className="rounded-md bg-background-section px-3 py-2 system-xs-regular text-text-tertiary">
        {t(($) => $['newKnowledge.sourceSetupBackendDependency'])}
      </p>
    </div>
  )
}
