'use client'

import type {
  NewKnowledgeOnlineDocumentsProvider,
  NewKnowledgeOnlineDocumentsSourceDraft,
  NewKnowledgeOnlineDriveProvider,
  NewKnowledgeOnlineDriveSourceDraft,
  NewKnowledgeSourceDraft,
  NewKnowledgeWebsiteSourceDraft,
} from '../setup/source-draft'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { Input } from '@langgenius/dify-ui/input'
import {
  NumberField,
  NumberFieldControls,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from '@langgenius/dify-ui/number-field'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio-group'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SourceProviderIcon, SourceSyncPolicyField } from '../setup/fields'
import { sourceProviderPresentation } from '../setup/provider-options'
import {
  isValidWebsiteSourceDraft,
  NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH,
  NEW_KNOWLEDGE_SOURCE_URL_MAX_LENGTH,
} from '../setup/source-draft'

const connectedProviders = {
  onlineDocuments: [
    { icon: 'i-custom-public-common-notion', label: 'Notion' },
    { icon: 'i-ri-file-text-fill text-[#4d8bf5]', label: 'Google Docs' },
    { icon: 'i-custom-public-common-confluence', label: 'Confluence' },
  ],
  onlineDrive: [
    { icon: 'i-custom-public-common-google-drive', label: 'Google Drive' },
    { icon: 'i-logos-microsoft-onedrive', label: 'OneDrive' },
    { icon: 'i-logos-aws-s3', label: 'Amazon S3' },
  ],
} as const

export function PendingWebsiteSetup({
  draft,
  onDraftChange,
}: {
  draft: NewKnowledgeWebsiteSourceDraft
  onDraftChange: (draft: NewKnowledgeWebsiteSourceDraft) => void
}) {
  const { t } = useTranslation('knowledgeSpace')
  const [optionsExpanded, setOptionsExpanded] = useState(false)
  const [backendBoundaryVisible, setBackendBoundaryVisible] = useState(false)
  const updateDraft = (nextDraft: NewKnowledgeWebsiteSourceDraft) => {
    onDraftChange(nextDraft)
    setBackendBoundaryVisible(false)
  }

  return (
    <section className="space-y-4" aria-label={t(($) => $.crawlAndPreview)}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field name="rootUrl" className="gap-1.5">
          <FieldLabel>{t(($) => $.rootUrl)}</FieldLabel>
          <Input
            type="url"
            inputMode="url"
            autoComplete="off"
            maxLength={NEW_KNOWLEDGE_SOURCE_URL_MAX_LENGTH}
            value={draft.rootUrl}
            placeholder={t(($) => $.rootUrlPlaceholder)}
            onValueChange={(value) => {
              updateDraft({ ...draft, rootUrl: value })
            }}
          />
        </Field>
        <Field name="sourceName" className="gap-1.5">
          <FieldLabel>{t(($) => $.sourceName)}</FieldLabel>
          <Input
            type="text"
            autoComplete="off"
            maxLength={NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH}
            value={draft.sourceName}
            placeholder={t(($) => $.sourceNamePlaceholder)}
            onValueChange={(value) => {
              updateDraft({ ...draft, sourceName: value })
            }}
          />
        </Field>
      </div>
      <Collapsible
        open={optionsExpanded}
        onOpenChange={setOptionsExpanded}
        className="overflow-hidden rounded-lg bg-background-section"
      >
        <CollapsibleTrigger className="min-h-9 justify-start px-3 system-xs-medium">
          <span
            aria-hidden
            className="i-ri-arrow-right-s-line size-4 transition-transform group-data-panel-open:rotate-90 motion-reduce:transition-none"
          />
          {t(($) => $.crawlOptions)}
          {!optionsExpanded && (
            <span className="ml-auto system-xs-regular text-text-tertiary">
              {t(($) => $.usingDefaults)}
            </span>
          )}
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <Fieldset className="grid grid-cols-1 gap-3 px-3 pb-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 system-xs-regular text-text-secondary">
              <Checkbox
                checked={draft.includeSubpages}
                onCheckedChange={(checked) => updateDraft({ ...draft, includeSubpages: checked })}
              />
              {t(($) => $.includeSubpages)}
            </label>
            <div>
              <span className="system-xs-medium text-text-secondary">{t(($) => $.maxPages)}</span>
              <NumberField
                min={1}
                max={200}
                value={draft.maxPages}
                onValueChange={(value) => updateDraft({ ...draft, maxPages: value ?? 0 })}
              >
                <NumberFieldGroup className="mt-1.5">
                  <NumberFieldInput aria-label={t(($) => $.maxPages)} />
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
        disabled={!isValidWebsiteSourceDraft(draft)}
        onClick={() => setBackendBoundaryVisible(true)}
      >
        {t(($) => $.crawlAndPreview)}
      </Button>
      <div className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-divider-regular px-6 text-center">
        <span className="flex size-10 items-center justify-center rounded-lg bg-background-section">
          <span aria-hidden className="i-ri-global-line size-5 text-text-tertiary" />
        </span>
        <p className="mt-2 system-xs-semibold text-text-primary">{t(($) => $.pagesAppearTitle)}</p>
        <p className="mt-2 system-xs-regular text-text-tertiary">
          {t(($) => $.pagesAppearDescription)}
        </p>
      </div>
      {backendBoundaryVisible && (
        <p
          role="alert"
          className="rounded-md bg-state-warning-hover px-3 py-2 system-xs-regular text-text-warning"
        >
          {t(($) => $.sourceSetupBackendDependency)}
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
  const { t } = useTranslation('knowledgeSpace')
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
      <Fieldset>
        <FieldsetLegend className="mb-1.5 py-0 system-xs-medium">
          {tCreation(($) => $['stepOne.website.chooseProvider'])}
        </FieldsetLegend>
        <RadioGroup<string>
          value={activeProvider}
          className="grid grid-cols-1 gap-2 sm:grid-cols-3"
          onValueChange={selectProvider}
        >
          {providers.map((option) => {
            const presentation = sourceProviderPresentation(option.label, sourceType)
            return (
              <RadioItem<string>
                key={option.label}
                value={option.label}
                className={cn(
                  'flex min-h-9 items-center justify-center gap-2 rounded-lg border border-divider-subtle px-3 system-xs-medium text-text-secondary outline-hidden',
                  'hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid',
                  'data-checked:border-components-option-card-option-selected-border data-checked:bg-components-option-card-option-selected-bg data-checked:text-text-primary',
                )}
              >
                <SourceProviderIcon fallbackIcon={presentation?.fallbackIcon ?? option.icon} />
                <span className="truncate">{option.label}</span>
              </RadioItem>
            )
          })}
        </RadioGroup>
      </Fieldset>

      {sourceType === 'onlineDrive' && (
        <section
          aria-label={t(($) => $.selectFilesAndFolders)}
          className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-divider-regular px-6 text-center"
        >
          <span className="flex size-10 items-center justify-center rounded-lg bg-background-section">
            <span aria-hidden className="i-ri-folder-open-line size-5 text-text-tertiary" />
          </span>
          <p className="mt-2 system-xs-semibold text-text-primary">
            {t(($) => $.selectFilesAndFolders)}
          </p>
        </section>
      )}

      <div>
        <Field name="sourceName" className="gap-1.5">
          <FieldLabel>
            {t(($) => $.sourceName)}
            <span aria-hidden className="ml-0.5 text-text-destructive">
              *
            </span>
          </FieldLabel>
          <Input
            type="text"
            autoComplete="off"
            maxLength={NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH}
            value={draft.sourceName}
            placeholder={t(($) => $.sourceNamePlaceholder)}
            onValueChange={(value) => onDraftChange({ ...draft, sourceName: value })}
          />
        </Field>
      </div>

      <div role="status" className="rounded-lg bg-background-section px-3 py-2">
        <p className="system-xs-regular text-text-tertiary">{t(($) => $.providerUnavailable)}</p>
      </div>
      <SourceSyncPolicyField draft={draft} size="large" onDraftChange={onDraftChange} />
    </div>
  )
}
