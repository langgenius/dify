'use client'

import type { DatasourceParameters, DatasourceParameterSchema } from './datasource-parameter-model'
import type { SourceEditValues } from './source-list-model'
import type { Source, SourceSyncPolicy } from './source-models'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Input } from '@langgenius/dify-ui/input'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDataSourceList } from '@/service/use-pipeline'
import { WebsiteDatasourceParameterForm } from './datasource-parameter-form'
import {
  datasourceIncludeSubpages,
  datasourceParameterRecord,
  invalidDatasourceParameters,
  missingRequiredDatasourceParameters,
  websiteDatasourceParameterSchemas,
  withDatasourceParameterDefaults,
} from './datasource-parameter-model'
import { NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH, normalizeWebsiteSourceUrl } from './routes'
import {
  metadataString,
  sourceCustomIntervalHours,
  sourceProviderDetails,
  sourceSyncMode,
  sourceSyncPolicyChanged,
} from './source-list-model'
import {
  discoverSourceProviderOptions,
  normalizeSourceProviderName,
} from './source-provider-options'
import { SyncPolicyField } from './sync-policy-field'

const MIN_CUSTOM_INTERVAL_HOURS = 1
const MAX_CUSTOM_INTERVAL_HOURS = 720

function sourceWebsiteParameters(source: Source): DatasourceParameters {
  const parameters = { ...(datasourceParameterRecord(source.metadata.parameters) ?? {}) }
  if (parameters.url === undefined) {
    const normalizedUrl = normalizeWebsiteSourceUrl(source.uri)
    if (normalizedUrl) parameters.url = normalizedUrl.toString()
  }
  return parameters
}

function sourceCrawlOptions(source: Source): Record<string, unknown> {
  const value = source.metadata.crawlOptions
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function sourceParametersForSchemas(
  source: Source,
  parameters: DatasourceParameters,
  schemas: DatasourceParameterSchema[],
) {
  const next = { ...parameters }
  const storedOptions = sourceCrawlOptions(source)
  const includeSubpagesSchema = schemas.find(
    (schema) => schema.name === 'crawl_subpages' || schema.name === 'crawl_sub_pages',
  )
  const includeSubpages =
    parameters.crawl_subpages ?? parameters.crawl_sub_pages ?? storedOptions.includeSubpages
  if (
    includeSubpagesSchema &&
    next[includeSubpagesSchema.name] === undefined &&
    typeof includeSubpages === 'boolean'
  )
    next[includeSubpagesSchema.name] = includeSubpages
  if (
    schemas.some((schema) => schema.name === 'limit') &&
    next.limit === undefined &&
    typeof storedOptions.limit === 'number'
  )
    next.limit = storedOptions.limit
  return withDatasourceParameterDefaults(schemas, next)
}

function sameParameters(left: DatasourceParameters, right: DatasourceParameters) {
  const leftEntries = Object.entries(left).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey),
  )
  const rightEntries = Object.entries(right).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey),
  )
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(
      ([key, value], index) =>
        key === rightEntries[index]?.[0] && value === rightEntries[index]?.[1],
    )
  )
}

function crawlOptions(source: Source, parameters: DatasourceParameters) {
  const storedOptions = sourceCrawlOptions(source)
  const includeSubpages = parameters.crawl_subpages ?? parameters.crawl_sub_pages
  return {
    includeSubpages:
      typeof includeSubpages === 'boolean'
        ? includeSubpages
        : typeof storedOptions.includeSubpages === 'boolean'
          ? storedOptions.includeSubpages
          : datasourceIncludeSubpages(parameters),
    limit:
      typeof parameters.limit === 'number'
        ? parameters.limit
        : typeof storedOptions.limit === 'number'
          ? storedOptions.limit
          : 200,
  }
}

export function SourceEditDialog({
  onEdit,
  onOpenChange,
  open,
  pending,
  source,
}: {
  onEdit: (values: SourceEditValues) => Promise<boolean>
  onOpenChange: (open: boolean) => void
  open: boolean
  pending: boolean
  source: Source
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <SourceEditDialogContent
          onEdit={onEdit}
          onOpenChange={onOpenChange}
          pending={pending}
          source={source}
        />
      )}
    </Dialog>
  )
}

function SourceEditDialogContent({
  onEdit,
  onOpenChange,
  pending,
  source,
}: {
  onEdit: (values: SourceEditValues) => Promise<boolean>
  onOpenChange: (open: boolean) => void
  pending: boolean
  source: Source
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const [initialSource] = useState(source)
  const providerName = sourceProviderDetails(initialSource).name ?? ''
  const providerKey = metadataString(initialSource.metadata, 'providerKey')
  const usesProviderDeclaration =
    initialSource.type === 'web' &&
    (initialSource.metadata.datasourceParameterMode === 'exact' ||
      Boolean(providerKey || providerName))
  const datasourcePluginsQuery = useDataSourceList(usesProviderDeclaration)
  const [initialParameters] = useState(() => sourceWebsiteParameters(initialSource))
  const [nextName, setNextName] = useState(initialSource.name)
  const [nextParameters, setNextParameters] = useState(initialParameters)
  const [nextSyncMode, setNextSyncMode] = useState<SourceSyncPolicy['mode']>(() =>
    sourceSyncMode(initialSource),
  )
  const [nextCustomIntervalHours, setNextCustomIntervalHours] = useState<number | ''>(() =>
    sourceCustomIntervalHours(initialSource),
  )
  const providerOptions = useMemo(
    () => discoverSourceProviderOptions('websiteCrawl', datasourcePluginsQuery.data ?? []),
    [datasourcePluginsQuery.data],
  )
  const normalizedProviderName = normalizeSourceProviderName(providerName)
  const providerOption = providerOptions.find(
    (option) =>
      option.key === providerKey ||
      normalizeSourceProviderName(option.label) === normalizedProviderName,
  )
  const providerLoading = usesProviderDeclaration && datasourcePluginsQuery.isPending
  const providerLoadFailed = usesProviderDeclaration && datasourcePluginsQuery.isError
  const providerConfigurationReady =
    !usesProviderDeclaration ||
    (!providerLoading && !providerLoadFailed && providerOption?.installed === true)
  const parameterSchemas = useMemo(() => {
    if (!usesProviderDeclaration) return websiteDatasourceParameterSchemas()
    return providerOption?.installed
      ? websiteDatasourceParameterSchemas(providerOption.datasource)
      : []
  }, [providerOption, usesProviderDeclaration])
  const displayedParameters = useMemo(
    () => sourceParametersForSchemas(initialSource, nextParameters, parameterSchemas),
    [initialSource, nextParameters, parameterSchemas],
  )
  const initialDisplayedParameters = useMemo(
    () => sourceParametersForSchemas(initialSource, initialParameters, parameterSchemas),
    [initialParameters, initialSource, parameterSchemas],
  )
  const customIntervalValid =
    typeof nextCustomIntervalHours === 'number' &&
    Number.isInteger(nextCustomIntervalHours) &&
    nextCustomIntervalHours >= MIN_CUSTOM_INTERVAL_HOURS &&
    nextCustomIntervalHours <= MAX_CUSTOM_INTERVAL_HOURS
  const parametersValid =
    initialSource.type !== 'web' ||
    !providerConfigurationReady ||
    (!missingRequiredDatasourceParameters(parameterSchemas, displayedParameters).length &&
      !invalidDatasourceParameters(parameterSchemas, displayedParameters).length)
  const nameChanged = nextName.trim() !== initialSource.name
  const parametersChanged =
    initialSource.type === 'web' && !sameParameters(initialDisplayedParameters, displayedParameters)
  const syncPolicyChanged =
    customIntervalValid &&
    sourceSyncPolicyChanged(initialSource, nextSyncMode, nextCustomIntervalHours as number)
  const editChanged = nameChanged || parametersChanged || syncPolicyChanged

  const submitEdit = async () => {
    const name = nextName.trim()
    if (!name || !customIntervalValid || !parametersValid || !editChanged || pending) return
    const normalizedUrl =
      initialSource.type === 'web' && typeof displayedParameters.url === 'string'
        ? normalizeWebsiteSourceUrl(displayedParameters.url)
        : undefined
    if (
      await onEdit({
        expectedVersion: initialSource.version,
        ...(nameChanged ? { name } : {}),
        ...(parametersChanged
          ? {
              metadata: {
                crawlOptions: crawlOptions(initialSource, displayedParameters),
                datasourceParameterMode: 'exact',
              },
              providerParameters: displayedParameters,
              ...(normalizedUrl ? { uri: normalizedUrl.toString() } : {}),
            }
          : {}),
        ...(syncPolicyChanged
          ? {
              syncPolicy: {
                customIntervalHours: nextCustomIntervalHours as number,
                expectedRevision: initialSource.syncPolicy?.revision ?? 0,
                mode: nextSyncMode,
              },
            }
          : {}),
      })
    )
      onOpenChange(false)
  }

  const sourceNameField = (
    <Field name="sourceName" className="gap-1.5">
      <FieldLabel htmlFor={`source-name-${initialSource.id}`}>
        {t(($) => $['newKnowledge.sourceName'])}
      </FieldLabel>
      <Input
        id={`source-name-${initialSource.id}`}
        autoComplete="off"
        disabled={pending}
        maxLength={NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH}
        value={nextName}
        onChange={(event) => setNextName(event.target.value)}
      />
    </Field>
  )

  return (
    <DialogContent className="w-160! max-w-[calc(100vw-2rem)]!">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submitEdit()
        }}
      >
        <DialogTitle className="title-xl-semi-bold text-text-primary">
          {tCommon(($) => $['operation.edit'])} {initialSource.name}
        </DialogTitle>
        {initialSource.type === 'web' ? (
          <div className="mt-5">
            {providerConfigurationReady ? (
              <WebsiteDatasourceParameterForm
                additionalPrimaryField={sourceNameField}
                disabled={pending}
                parameters={displayedParameters}
                schemas={parameterSchemas}
                onChange={setNextParameters}
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {sourceNameField}
                {providerLoading ? (
                  <div
                    role="status"
                    aria-label={tCommon(($) => $.loading)}
                    className="space-y-2 pt-0.5"
                  >
                    <span className="block h-4 w-24 animate-pulse rounded bg-util-colors-gray-gray-200 motion-reduce:animate-none" />
                    <span className="block h-8 w-full animate-pulse rounded-lg bg-util-colors-gray-gray-200 motion-reduce:animate-none" />
                  </div>
                ) : (
                  <p role="alert" className="pt-7 system-sm-regular text-text-destructive">
                    {providerLoadFailed
                      ? t(($) => $['newKnowledge.providerLoadFailed'])
                      : t(($) => $['newKnowledge.providerUnavailable'])}
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-5">{sourceNameField}</div>
        )}
        <div className="mt-4">
          <SyncPolicyField
            disabled={pending}
            label
            triggerClassName="w-full"
            value={{
              customIntervalSeconds:
                typeof nextCustomIntervalHours === 'number'
                  ? nextCustomIntervalHours * 3600
                  : undefined,
              mode: nextSyncMode,
            }}
            onChange={(value) => {
              setNextSyncMode(value.mode)
              if (value.customIntervalSeconds)
                setNextCustomIntervalHours(value.customIntervalSeconds / 3600)
            }}
          />
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button disabled={pending} onClick={() => onOpenChange(false)} type="button">
            {tCommon(($) => $['operation.cancel'])}
          </Button>
          <Button
            disabled={!nextName.trim() || !customIntervalValid || !parametersValid || !editChanged}
            loading={pending}
            type="submit"
            variant="primary"
          >
            {tCommon(($) => $['operation.save'])}
          </Button>
        </div>
      </form>
    </DialogContent>
  )
}
