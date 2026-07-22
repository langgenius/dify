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
    <div className="mt-3 space-y-4 rounded-xl bg-background-section p-4">
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
        <legend className="mb-1.5 system-xs-medium text-text-secondary">
          {tCreation(($) => $['stepOne.website.chooseProvider'])}
        </legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block system-xs-medium text-text-secondary">
            {t(($) => $['newKnowledge.rootUrl'])}
            <input
              type="url"
              disabled
              placeholder={t(($) => $['newKnowledge.rootUrlPlaceholder'])}
              className="mt-1.5 h-9 w-full rounded-lg border-0 bg-components-input-bg-normal px-3 text-text-disabled"
            />
          </label>
          <label className="block system-xs-medium text-text-secondary">
            {t(($) => $['newKnowledge.sourceName'])}
            <input
              type="text"
              disabled
              placeholder={t(($) => $['newKnowledge.sourceNamePlaceholder'])}
              className="mt-1.5 h-9 w-full rounded-lg border-0 bg-components-input-bg-normal px-3 text-text-disabled"
            />
          </label>
        </div>
      )}

      <p className="system-xs-regular text-text-tertiary">
        {sourceType === 'websiteCrawl'
          ? t(($) => $['newKnowledge.routeUnavailable'])
          : t(($) => $['newKnowledge.providerUnavailable'])}
      </p>
    </div>
  )
}
