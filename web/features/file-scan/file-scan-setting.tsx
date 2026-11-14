'use client'

import type { ReactNode } from 'react'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Field, FieldItem, FieldLabel } from '@langgenius/dify-ui/field'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { Radio, RadioGroup } from '@langgenius/dify-ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { Switch } from '@langgenius/dify-ui/switch'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { buildIntegrationPath } from '@/app/components/integrations/routes'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import Link from '@/next/link'
import { consoleQuery } from '@/service/console'
import { getErrorMessage } from '@/utils/error-message'
import { useFileScanEnabled, useFileScanProviderTypeLabel } from './provider-types'

type FileScanProduct = 'dataset' | 'knowledge-fs'
type FallbackAction = 'allow' | 'block'
type FileScanPolicy = {
  enabled: boolean
  on_unavailable: FallbackAction
  on_unscannable: FallbackAction
  provider_id: string | null
}

type FileScanSettingProps = {
  className?: string
  /** Which knowledge base product `resourceId` belongs to. */
  product: FileScanProduct
  readonly: boolean
  /** The dataset id, or the control space id of an Agent Knowledge Base. */
  resourceId: string
}

const DEFAULT_POLICY: FileScanPolicy = {
  enabled: false,
  on_unavailable: 'block',
  on_unscannable: 'block',
  provider_id: null,
}

const fallbackAction = (value: string | undefined): FallbackAction =>
  value === 'allow' ? 'allow' : 'block'

// Both settings pages put the label beside the control once their own container is wide enough.
const layoutClassNames: Record<FileScanProduct, { label: string; row: string }> = {
  dataset: {
    label: '@3xl/settings:w-45',
    row: '@3xl/settings:flex-row @3xl/settings:gap-x-1',
  },
  'knowledge-fs': {
    label: 'sm:w-45',
    row: 'sm:flex-row sm:gap-1',
  },
}

function useFileScanPolicy(product: FileScanProduct, resourceId: string) {
  const datasetPolicy = consoleQuery.datasets.byDatasetId.fileScanPolicy
  const spacePolicy = consoleQuery.knowledgeFs.spaces.byControlSpaceId.fileScanPolicy
  const datasetQuery = useQuery(
    datasetPolicy.get.queryOptions({
      input: { params: { dataset_id: resourceId } },
      enabled: product === 'dataset',
    }),
  )
  const spaceQuery = useQuery(
    spacePolicy.get.queryOptions({
      input: { params: { control_space_id: resourceId } },
      enabled: product === 'knowledge-fs',
    }),
  )
  const datasetMutation = useMutation(
    datasetPolicy.put.mutationOptions({ context: { silent: true } }),
  )
  const spaceMutation = useMutation(spacePolicy.put.mutationOptions({ context: { silent: true } }))
  const query = product === 'dataset' ? datasetQuery : spaceQuery
  const mutation = product === 'dataset' ? datasetMutation : spaceMutation

  return {
    isError: query.isError,
    isPending: query.isPending,
    isSaving: mutation.isPending,
    policy: query.data
      ? {
          enabled: query.data.enabled,
          on_unavailable: fallbackAction(query.data.on_unavailable),
          on_unscannable: fallbackAction(query.data.on_unscannable),
          provider_id: query.data.provider_id ?? null,
        }
      : undefined,
    refetch: () => void query.refetch(),
    resetSaveError: () => mutation.reset(),
    save: (body: FileScanPolicy, onSuccess: () => void) => {
      if (product === 'dataset')
        datasetMutation.mutate({ body, params: { dataset_id: resourceId } }, { onSuccess })
      else spaceMutation.mutate({ body, params: { control_space_id: resourceId } }, { onSuccess })
    },
    saveError: mutation.error,
  }
}

function FallbackField({
  className,
  description,
  disabled,
  labelClassName,
  legend,
  name,
  onChange,
  value,
}: {
  className: string
  description?: string
  disabled: boolean
  labelClassName: string
  legend: string
  name: string
  onChange: (value: FallbackAction) => void
  value: FallbackAction
}) {
  const { t } = useTranslation(['fileScan'])
  const descriptionId = useId()

  return (
    <Field name={name}>
      <Fieldset
        render={
          <RadioGroup<FallbackAction>
            aria-describedby={description ? descriptionId : undefined}
            className={className}
            disabled={disabled}
            value={value}
            onValueChange={onChange}
          />
        }
      >
        <FieldsetLegend className={labelClassName}>{legend}</FieldsetLegend>
        <div className="min-w-0 flex-1">
          <div className="flex min-h-7 flex-wrap items-center gap-x-6 gap-y-1">
            {(['block', 'allow'] as const).map((action) => (
              <FieldItem key={action}>
                <FieldLabel className="flex cursor-pointer items-center gap-2 py-0 system-sm-regular text-text-primary">
                  <Radio<FallbackAction> value={action} />
                  {t(($) => $[`policy.${action}`])}
                </FieldLabel>
              </FieldItem>
            ))}
          </div>
          {description && (
            <p id={descriptionId} className="mt-1 system-xs-regular text-text-tertiary">
              {description}
            </p>
          )}
        </div>
      </Fieldset>
    </Field>
  )
}

function FileScanPolicyEditor({ className, product, readonly, resourceId }: FileScanSettingProps) {
  const { t } = useTranslation(['fileScan'])
  const { t: tCommon } = useTranslation(['common'])
  const typeLabel = useFileScanProviderTypeLabel()
  const titleId = useId()
  const enableDescriptionId = useId()
  const canManageScanners = useAtomValue(isCurrentWorkspaceManagerAtom)
  const { isError, isPending, isSaving, policy, refetch, resetSaveError, save, saveError } =
    useFileScanPolicy(product, resourceId)
  const providersQuery = useQuery(consoleQuery.fileScan.providers.get.queryOptions())
  const providers = providersQuery.data?.data ?? []
  const [draft, setDraft] = useState<FileScanPolicy>()
  const [scannerMissing, setScannerMissing] = useState(false)
  const saved = policy ?? DEFAULT_POLICY
  const current = draft ?? saved
  const dirty =
    current.enabled !== saved.enabled ||
    current.provider_id !== saved.provider_id ||
    current.on_unavailable !== saved.on_unavailable ||
    current.on_unscannable !== saved.on_unscannable
  const disabled = readonly || isPending || isError || isSaving
  const selectedProvider = providers.find((provider) => provider.id === current.provider_id)
  const layout = layoutClassNames[product]
  const rowClassName = cn('flex min-w-0 flex-col items-stretch gap-2', layout.row)
  const labelClassName = cn(
    'mb-0 flex min-h-7 shrink-0 items-center py-0 pt-1 system-sm-semibold text-text-secondary',
    layout.label,
  )

  const update = (patch: Partial<FileScanPolicy>) => {
    setDraft({ ...current, ...patch })
    setScannerMissing(false)
    resetSaveError()
  }

  const handleSave = () => {
    if (disabled || !dirty) return
    if (current.enabled && !current.provider_id) {
      setScannerMissing(true)
      return
    }
    save(current, () => setDraft(undefined))
  }

  const row = (label: ReactNode, children: ReactNode) => (
    <div className={rowClassName}>
      <div className={labelClassName}>{label}</div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )

  return (
    <section aria-labelledby={titleId} className={cn('flex flex-col gap-4', className)}>
      {row(
        <h2 id={titleId} className="system-sm-semibold text-text-secondary">
          {t(($) => $['policy.title'])}
        </h2>,
        <div className="flex min-h-7 items-center gap-2">
          <Switch
            aria-label={t(($) => $['policy.enable'])}
            aria-describedby={enableDescriptionId}
            checked={current.enabled}
            disabled={disabled}
            onCheckedChange={(enabled) => update({ enabled })}
          />
          <p
            id={enableDescriptionId}
            className="min-w-0 flex-1 system-xs-regular text-text-tertiary"
          >
            {t(($) => $['policy.enableDescription'])}
          </p>
        </div>,
      )}

      {isError &&
        row(
          null,
          <div role="alert" className="flex items-center gap-2">
            <p className="system-xs-regular text-text-destructive">
              {t(($) => $['policy.loadFailed'])}
            </p>
            <Button size="small" type="button" onClick={refetch}>
              {tCommon(($) => $['operation.retry'])}
            </Button>
          </div>,
        )}

      {current.enabled && (
        <>
          {providersQuery.isSuccess && !providers.length ? (
            row(
              t(($) => $['policy.scanner']),
              <div className="flex min-h-7 flex-wrap items-center gap-2 rounded-lg bg-state-warning-hover px-3 py-2">
                <p className="min-w-0 flex-1 system-xs-regular text-text-secondary">
                  {t(($) =>
                    canManageScanners ? $['policy.noScannersAdmin'] : $['policy.noScanners'],
                  )}
                </p>
                {canManageScanners && (
                  <Link
                    className={buttonVariants({ size: 'small' })}
                    href={buildIntegrationPath('file-scan')}
                  >
                    {t(($) => $['policy.openSettings'])}
                  </Link>
                )}
              </div>,
            )
          ) : (
            <Field name="provider_id" invalid={scannerMissing} className={rowClassName}>
              <Select<string | null>
                disabled={disabled}
                value={current.provider_id}
                onValueChange={(providerId) => update({ provider_id: providerId })}
              >
                <SelectLabel className={labelClassName}>
                  {t(($) => $['policy.scanner'])}
                </SelectLabel>
                <div className="min-w-0 flex-1">
                  <SelectTrigger>
                    {selectedProvider ? (
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{selectedProvider.name}</span>
                        {selectedProvider.status === 'error' && (
                          <span className="shrink-0 system-xs-medium text-text-destructive">
                            {t(($) => $['scanner.status.error'])}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-components-input-text-placeholder">
                        {t(($) => $['policy.scannerPlaceholder'])}
                      </span>
                    )}
                  </SelectTrigger>
                  {scannerMissing && (
                    <p role="alert" className="mt-1 system-xs-regular text-text-destructive">
                      {t(($) => $['policy.scannerRequired'])}
                    </p>
                  )}
                </div>
                <SelectContent>
                  {providers.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      <SelectItemText>
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate">{provider.name}</span>
                          <span className="shrink-0 system-xs-regular text-text-tertiary">
                            {typeLabel(provider.provider_type)}
                          </span>
                          {provider.status === 'error' && (
                            <span className="shrink-0 system-xs-medium text-text-destructive">
                              {t(($) => $['scanner.status.error'])}
                            </span>
                          )}
                        </span>
                      </SelectItemText>
                      <SelectItemIndicator />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          <FallbackField
            name="on_unavailable"
            className={rowClassName}
            labelClassName={labelClassName}
            legend={t(($) => $['policy.onUnavailable'])}
            description={t(($) => $['policy.onUnavailableDescription'])}
            disabled={disabled}
            value={current.on_unavailable}
            onChange={(action) => update({ on_unavailable: action })}
          />
          <FallbackField
            name="on_unscannable"
            className={rowClassName}
            labelClassName={labelClassName}
            legend={t(($) => $['policy.onUnscannable'])}
            disabled={disabled}
            value={current.on_unscannable}
            onChange={(action) => update({ on_unscannable: action })}
          />
        </>
      )}

      {!readonly &&
        (dirty || saveError) &&
        row(
          null,
          <div className="flex flex-col items-start gap-2">
            {saveError && (
              <p
                role="alert"
                className="rounded-lg bg-state-destructive-hover px-3 py-2 system-xs-regular text-text-destructive"
              >
                {getErrorMessage(saveError) ?? t(($) => $['policy.saveFailed'])}
              </p>
            )}
            {/* The surrounding settings form owns its own submit, so this section saves by itself. */}
            <Button
              type="button"
              variant="primary"
              size="small"
              disabled={!dirty}
              loading={isSaving}
              onClick={handleSave}
            >
              {tCommon(($) => $['operation.save'])}
            </Button>
          </div>,
        )}
    </section>
  )
}

/** Malware-scan policy of one knowledge base. Renders nothing while the feature is disabled. */
export function FileScanSetting(props: FileScanSettingProps) {
  const enabled = useFileScanEnabled()
  if (!enabled) return null
  return <FileScanPolicyEditor {...props} />
}
