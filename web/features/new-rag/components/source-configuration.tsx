'use client'

import type { GetSourceProvidersResponse } from '@dify/contracts/knowledge-fs/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Field, FieldControl, FieldLabel } from '@langgenius/dify-ui/field'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'

type SourceProvider = GetSourceProvidersResponse['items'][number]

export function SourceConfiguration({
  disabled,
  name,
  onNameChange,
  onPreview,
  onProviderChange,
  onUrlChange,
  previewPages,
  previewPending,
  providerId,
  url,
}: {
  disabled: boolean
  name: string
  onNameChange: (value: string) => void
  onPreview: () => void
  onProviderChange: (value: string) => void
  onUrlChange: (value: string) => void
  previewPages: Array<{ sourceUrl: string; title?: string }>
  previewPending: boolean
  providerId: string
  url: string
}) {
  const { t } = useTranslation('dataset')
  const { t: tCreation } = useTranslation('datasetCreation')
  const providersQuery = useQuery(
    consoleQuery.knowledgeFs.getSourceProviders.queryOptions({
      context: { silent: true },
      input: {},
      retry: false,
    }),
  )
  const availableProviders = useMemo(
    () =>
      providersQuery.data?.items.filter(
        (provider) => provider.available && provider.capabilities.includes('website-crawl'),
      ) ?? [],
    [providersQuery.data],
  )
  const canPreview = Boolean(name.trim() && url.trim() && providerId && !disabled)

  useEffect(() => {
    if (
      availableProviders.length > 0 &&
      !availableProviders.some((provider) => provider.id === providerId)
    ) {
      onProviderChange(availableProviders[0]!.id)
    }
  }, [availableProviders, onProviderChange, providerId])

  return (
    <div className="space-y-4 px-4 pb-4">
      <div>
        <p className="mb-1.5 system-xs-medium text-text-secondary">
          {tCreation(($) => $['stepOne.website.chooseProvider'])}
        </p>
        {providersQuery.isPending && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="status">
            {Array.from({ length: 4 }, (_, index) => (
              <span
                key={index}
                className="h-[34px] animate-pulse rounded-lg bg-background-section"
              />
            ))}
          </div>
        )}
        {providersQuery.isError && (
          <div className="rounded-lg bg-components-badge-status-light-error-bg px-3 py-2 system-xs-regular text-text-destructive">
            {t(($) => $['newKnowledge.sourceProvidersFailed'])}
          </div>
        )}
        {providersQuery.isSuccess && availableProviders.length === 0 && (
          <div className="rounded-lg border border-divider-subtle bg-background-section px-3 py-2 system-xs-regular text-text-tertiary">
            {t(($) => $['newKnowledge.sourceProvidersEmpty'])}
          </div>
        )}
        {availableProviders.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {availableProviders.map((provider: SourceProvider) => (
              <button
                key={provider.id}
                type="button"
                disabled={disabled}
                aria-pressed={providerId === provider.id}
                className={cn(
                  'flex h-[34px] min-w-0 items-center justify-center gap-1.5 rounded-lg border bg-background-default px-2 system-xs-medium text-text-primary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:text-text-disabled',
                  providerId === provider.id
                    ? 'border-[1.5px] border-components-option-card-option-selected-border'
                    : 'border-components-option-card-option-border',
                )}
                onClick={() => onProviderChange(provider.id)}
              >
                <span aria-hidden className="i-ri-global-line size-4 shrink-0 text-text-accent" />
                <span className="truncate">{provider.displayName}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="sourceUrl" className="gap-1.5">
          <FieldLabel>
            {t(($) => $['newKnowledge.sourceUrl'])}
            <span aria-hidden className="ml-0.5 text-text-destructive">
              *
            </span>
          </FieldLabel>
          <FieldControl
            type="url"
            disabled={disabled}
            placeholder="https://docs.example.com"
            required
            value={url}
            onValueChange={onUrlChange}
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
            disabled={disabled}
            placeholder={t(($) => $['newKnowledge.sourceNamePlaceholder'])}
            required
            value={name}
            onValueChange={onNameChange}
          />
        </Field>
      </div>

      <Button
        type="button"
        variant="primary"
        className="w-full"
        disabled={!canPreview}
        loading={previewPending}
        onClick={onPreview}
      >
        {tCreation(($) => $['stepOne.website.run'])}
      </Button>

      <div className="overflow-hidden rounded-xl border border-dashed border-components-dropzone-border bg-components-dropzone-bg">
        {previewPages.length === 0 ? (
          <div className="flex min-h-36 flex-col items-center justify-center gap-2 px-6 py-8 text-center">
            <span className="flex size-10 items-center justify-center rounded-[10px] bg-background-section">
              <span aria-hidden className="i-ri-global-line size-5 text-text-secondary" />
            </span>
            <p className="system-sm-semibold text-text-primary">
              {t(($) => $['newKnowledge.crawlPreviewEmptyTitle'])}
            </p>
            <p className="system-xs-regular text-text-tertiary">
              {t(($) => $['newKnowledge.crawlPreviewEmptyDescription'])}
            </p>
          </div>
        ) : (
          <ul className="max-h-48 divide-y divide-divider-subtle overflow-y-auto">
            {previewPages.map((page) => (
              <li key={page.sourceUrl} className="flex items-center gap-2 px-3 py-2">
                <span aria-hidden className="i-ri-checkbox-circle-fill size-4 text-text-success" />
                <span className="min-w-0 flex-1 truncate system-xs-medium text-text-secondary">
                  {page.title || page.sourceUrl}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
