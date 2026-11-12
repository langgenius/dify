'use client'

import type {
  FileScanProviderResponse,
  FileScanProviderTypeResponse,
} from '@dify/contracts/api/console/file-scan/types.gen'
import type { FileScanProviderType, ScaniiRegion } from './provider-types'
import { Alert, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
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
import { useMutation } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { getErrorMessage } from '@/utils/error-message'
import { ProviderTypeIcon } from './provider-type-icon'
import {
  FILE_SCAN_PROVIDER_TYPES,
  fileScanProviderApiKeyUrl,
  fileScanProviderSendsFileContents,
  isFileScanProviderType,
  isScaniiRegion,
  SCANII_REGIONS,
  useFileScanProviderTypeLabel,
} from './provider-types'

type FileScanProviderDialogProps = {
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  open: boolean
  /** The scanner being edited. Its type is fixed; omit it to add a scanner. */
  provider?: FileScanProviderResponse
  providerTypes: FileScanProviderTypeResponse[]
}

const stringSetting = (value: unknown) => (typeof value === 'string' ? value : '')

function isHttpUrl(value: string) {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export function FileScanProviderDialog({
  onOpenChange,
  onSaved,
  open,
  provider,
  providerTypes,
}: FileScanProviderDialogProps) {
  const { t } = useTranslation(['fileScan'])
  const { t: tCommon } = useTranslation(['common'])
  const typeLabel = useFileScanProviderTypeLabel()
  const typeLabelId = useId()
  const privateProcessingId = useId()
  const availableTypes = FILE_SCAN_PROVIDER_TYPES.filter((candidate) =>
    providerTypes.some((item) => item.provider_type === candidate && item.available),
  )
  const editedType =
    provider && isFileScanProviderType(provider.provider_type) ? provider.provider_type : undefined
  const [selectedType, setSelectedType] = useState<FileScanProviderType | undefined>(editedType)
  const type = editedType ?? selectedType ?? availableTypes[0]
  const [name, setName] = useState(provider?.name ?? '')
  const [credentials, setCredentials] = useState<Record<string, string>>({})
  const [endpoint, setEndpoint] = useState(() => stringSetting(provider?.config.endpoint))
  const [region, setRegion] = useState<ScaniiRegion>(() =>
    isScaniiRegion(provider?.config.region) ? provider.config.region : 'us1',
  )
  const [privateProcessing, setPrivateProcessing] = useState(
    provider?.config.private_processing === true,
  )
  const createMutation = useMutation(
    consoleQuery.fileScan.providers.post.mutationOptions({ context: { silent: true } }),
  )
  const updateMutation = useMutation(
    consoleQuery.fileScan.providers.byProviderId.patch.mutationOptions({
      context: { silent: true },
    }),
  )
  const isSaving = createMutation.isPending || updateMutation.isPending
  const saveError = createMutation.error ?? updateMutation.error
  const credentialFields =
    providerTypes.find((item) => item.provider_type === type)?.credential_fields ?? []

  // The backend refuses to send stored credentials to a new address, so a changed address needs
  // the secrets typed again.
  const addressChanged =
    provider !== undefined &&
    (type === 'cloudmersive' || type === 'api') &&
    endpoint.trim() !== stringSetting(provider.config.endpoint)

  const apiKeyUrl = type ? fileScanProviderApiKeyUrl(type) : undefined

  const resetSaveError = () => {
    createMutation.reset()
    updateMutation.reset()
  }

  const credentialLabel = (field: string) => {
    if (field === 'api_key') return t(($) => $['dialog.apiKey'])
    if (field === 'api_secret') return t(($) => $['dialog.apiSecret'])
    return field
  }

  const handleSubmit = () => {
    if (!type || isSaving) return
    const config: Record<string, unknown> = {}
    if ((type === 'cloudmersive' || type === 'api') && endpoint.trim())
      config.endpoint = endpoint.trim()
    if (type === 'scanii') config.region = region
    if (type === 'metadefender') config.private_processing = privateProcessing
    // A blank secret keeps the stored value when editing, so only typed secrets are sent.
    const typedCredentials = Object.fromEntries(
      credentialFields
        .map((field) => [field, credentials[field]?.trim() ?? ''] as const)
        .filter(([, value]) => value),
    )

    if (provider) {
      updateMutation.mutate(
        {
          params: { provider_id: provider.id },
          body: {
            name: name.trim(),
            config,
            ...(Object.keys(typedCredentials).length ? { credentials: typedCredentials } : {}),
          },
        },
        { onSuccess: onSaved },
      )
      return
    }
    createMutation.mutate(
      {
        body: { name: name.trim(), provider_type: type, config, credentials: typedCredentials },
      },
      { onSuccess: onSaved },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} disablePointerDismissal>
      <DialogContent backdropProps={{ forceRender: true }} className="w-150">
        <DialogHeader>
          <DialogTitle>
            {t(($) => (provider ? $['dialog.editTitle'] : $['dialog.addTitle']))}
          </DialogTitle>
          <DialogHeaderCloseButton aria-label={tCommon(($) => $['operation.close'])} />
        </DialogHeader>
        <Form className="contents" onFormSubmit={handleSubmit}>
          <DialogBody className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <div id={typeLabelId} className="system-sm-medium text-text-secondary">
                {t(($) => $['dialog.type'])}
              </div>
              {provider ? (
                <div className="flex items-center gap-2 system-sm-regular text-text-primary">
                  {editedType && <ProviderTypeIcon type={editedType} />}
                  {typeLabel(provider.provider_type)}
                </div>
              ) : (
                <div role="group" aria-labelledby={typeLabelId} className="grid grid-cols-3 gap-2">
                  {availableTypes.map((candidate) => (
                    <button
                      type="button"
                      key={candidate}
                      aria-pressed={type === candidate}
                      className={cn(
                        'flex min-h-17 flex-col items-start justify-center gap-1.5 rounded-xl border border-components-option-card-option-border bg-components-option-card-option-bg px-3 py-2 text-start text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
                        type === candidate
                          ? 'border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg shadow-xs'
                          : 'hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs',
                      )}
                      onClick={() => {
                        setSelectedType(candidate)
                        setCredentials({})
                        setEndpoint('')
                        resetSaveError()
                      }}
                    >
                      <span className="flex size-8 items-center justify-center rounded-lg border-[0.5px] border-divider-regular bg-background-default-dodge">
                        <ProviderTypeIcon type={candidate} />
                      </span>
                      <span className="w-full truncate system-xs-regular">
                        {typeLabel(candidate)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {type && fileScanProviderSendsFileContents(type) && (
                <p className="mt-1 flex items-start gap-1.5 rounded-lg bg-state-warning-hover px-3 py-2 system-xs-regular text-text-secondary">
                  <span
                    aria-hidden
                    className="mt-px i-ri-information-2-line size-3.5 shrink-0 text-text-warning"
                  />
                  {t(($) => $['dialog.dataNotice'])}
                </p>
              )}
              {type === 'clamav' && (
                <p className="mt-1 system-xs-regular text-text-tertiary">
                  {t(($) => $['dialog.clamavHint'])}
                </p>
              )}
            </div>

            <Field name="name">
              <FieldLabel>{t(($) => $['dialog.name'])}</FieldLabel>
              <Input
                required
                value={name}
                placeholder={t(($) => $['dialog.namePlaceholder'])}
                onValueChange={setName}
              />
              <FieldError match="valueMissing">
                {tCommon(($) => $['errorMsg.fieldRequired'], {
                  field: t(($) => $['dialog.name']),
                })}
              </FieldError>
            </Field>

            {type === 'api' && (
              <Field
                name="endpoint"
                validate={(value) =>
                  typeof value === 'string' && value.trim() && !isHttpUrl(value.trim())
                    ? t(($) => $['dialog.endpointUrlInvalid'])
                    : null
                }
              >
                <FieldLabel>{t(($) => $['dialog.endpointUrl'])}</FieldLabel>
                <Input
                  required
                  maxLength={512}
                  value={endpoint}
                  placeholder="https://scanner.example.com/scan"
                  onValueChange={setEndpoint}
                />
                <FieldDescription>{t(($) => $['dialog.endpointUrlDescription'])}</FieldDescription>
                <FieldError match="valueMissing">
                  {tCommon(($) => $['errorMsg.fieldRequired'], {
                    field: t(($) => $['dialog.endpointUrl']),
                  })}
                </FieldError>
                <FieldError match="customError" />
              </Field>
            )}

            {credentialFields.map((field) => {
              const saved = provider?.credentials_set[field] === true
              const stored = saved && !addressChanged
              return (
                <Field key={`${type}-${field}`} name={field}>
                  <FieldLabel>{credentialLabel(field)}</FieldLabel>
                  <Input
                    type="password"
                    autoComplete="off"
                    required={!stored}
                    value={credentials[field] ?? ''}
                    placeholder={stored ? t(($) => $['dialog.savedSecretPlaceholder']) : undefined}
                    onValueChange={(value) =>
                      setCredentials((current) => ({ ...current, [field]: value }))
                    }
                  />
                  {saved && addressChanged && (
                    <FieldDescription>{t(($) => $['dialog.reenterApiKey'])}</FieldDescription>
                  )}
                  <FieldError match="valueMissing">
                    {tCommon(($) => $['errorMsg.fieldRequired'], {
                      field: credentialLabel(field),
                    })}
                  </FieldError>
                </Field>
              )
            })}

            {type === 'cloudmersive' && (
              <Field name="endpoint">
                <FieldLabel>{t(($) => $['dialog.endpoint'])}</FieldLabel>
                <Input
                  type="url"
                  pattern="https://.*"
                  value={endpoint}
                  placeholder="https://"
                  onValueChange={setEndpoint}
                />
                <FieldDescription>{t(($) => $['dialog.endpointDescription'])}</FieldDescription>
                <FieldError />
              </Field>
            )}

            {type === 'scanii' && (
              <Field name="region">
                <Select<ScaniiRegion>
                  value={region}
                  onValueChange={(nextRegion) => {
                    if (nextRegion) setRegion(nextRegion)
                  }}
                >
                  <SelectLabel>{t(($) => $['dialog.regionLabel'])}</SelectLabel>
                  <SelectTrigger>{t(($) => $[`dialog.region.${region}`])}</SelectTrigger>
                  <SelectContent>
                    {SCANII_REGIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        <SelectItemText>{t(($) => $[`dialog.region.${option}`])}</SelectItemText>
                        <SelectItemIndicator />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}

            {type === 'metadefender' && (
              <Field name="private_processing">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <FieldLabel htmlFor={privateProcessingId}>
                      {t(($) => $['dialog.privateProcessing'])}
                    </FieldLabel>
                    <FieldDescription>
                      {t(($) => $['dialog.privateProcessingDescription'])}
                    </FieldDescription>
                  </div>
                  <Switch
                    id={privateProcessingId}
                    className="mt-0.5"
                    checked={privateProcessing}
                    onCheckedChange={setPrivateProcessing}
                  />
                </div>
              </Field>
            )}

            {saveError ? (
              <Alert type="error">
                <AlertTitle>
                  {getErrorMessage(saveError) ?? t(($) => $['dialog.saveFailed'])}
                </AlertTitle>
              </Alert>
            ) : (
              <p className="system-xs-regular text-text-tertiary">
                {t(($) => $['dialog.saveHint'])}
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            {type && apiKeyUrl && (
              <a
                href={apiKeyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="me-auto inline-block align-middle system-xs-regular text-text-accent"
              >
                {t(($) => $['dialog.getApiKey'], { vendor: typeLabel(type) })}
                <span
                  aria-hidden
                  className="ms-1 -mt-0.5 i-custom-vender-line-general-link-external-02 inline-block h-3 w-3 align-middle rtl:-scale-x-100"
                />
              </a>
            )}
            <Button type="button" onClick={() => onOpenChange(false)}>
              {tCommon(($) => $['operation.cancel'])}
            </Button>
            <Button type="submit" variant="primary" disabled={!type} loading={isSaving}>
              {tCommon(($) => $['operation.save'])}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
