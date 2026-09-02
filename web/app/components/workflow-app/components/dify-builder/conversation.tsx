import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { ConversationItem, FormField } from '@/app/components/dify-builder/types'
import { cn } from '@langgenius/dify-ui/cn'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileUploaderInAttachmentWrapper } from '@/app/components/base/file-uploader'
import { MAX_FILE_UPLOAD_LIMIT } from '@/app/components/base/file-uploader/constants'
import { fileIsUploaded, getProcessedFiles } from '@/app/components/base/file-uploader/utils'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import { useStore } from '@/app/components/workflow/store'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import { DifyBuilderCardShell } from './cards/card-shell'
import { groupConversationItems } from './conversation/group-conversation-items'

type ActionPayloadChange = (actionId: string, payload: Record<string, unknown>) => void
type ActionValidityChange = (actionId: string, valid: boolean) => void

const FILE_FIELD_TYPES = new Set(['file', 'file-list', 'files'])
const MULTI_FILE_FIELD_TYPES = new Set(['file-list', 'files'])
const DEFAULT_ALLOWED_FILE_TYPES = [
  SupportUploadFileTypes.image,
  SupportUploadFileTypes.document,
  SupportUploadFileTypes.audio,
  SupportUploadFileTypes.video,
]
const DEFAULT_ALLOWED_FILE_EXTENSIONS = DEFAULT_ALLOWED_FILE_TYPES.flatMap(
  (type) => FILE_EXTS[type] ?? [],
)
const DEFAULT_ALLOWED_FILE_UPLOAD_METHODS = [TransferMethod.local_file, TransferMethod.remote_url]
const FILE_TYPE_VALUES = new Set<string>(Object.values(SupportUploadFileTypes))
const FILE_UPLOAD_METHOD_VALUES = new Set<string>(Object.values(TransferMethod))
const EMPTY_FORM_FIELDS: FormField[] = []

type FormValidationError =
  | 'invalid-json'
  | 'invalid-json-object'
  | 'invalid-number'
  | 'invalid-option'
  | 'invalid-value'
  | 'max-files'
  | 'max-length'
  | 'required'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toFileEntity = (value: unknown): FileEntity | null => {
  if (!isRecord(value)) return null

  if (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.size === 'number' &&
    typeof value.type === 'string' &&
    typeof value.progress === 'number' &&
    typeof value.transferMethod === 'string' &&
    typeof value.supportFileType === 'string'
  ) {
    return value as FileEntity
  }

  const uploadedId =
    typeof value.uploadedId === 'string'
      ? value.uploadedId
      : typeof value.upload_file_id === 'string'
        ? value.upload_file_id
        : ''
  const url = typeof value.url === 'string' ? value.url : ''
  if (!uploadedId && !url) return null

  const transferMethod =
    value.transfer_method === TransferMethod.remote_url
      ? TransferMethod.remote_url
      : TransferMethod.local_file
  const supportFileType = typeof value.type === 'string' ? value.type : ''
  const id =
    typeof value.id === 'string'
      ? value.id
      : typeof value.related_id === 'string'
        ? value.related_id
        : uploadedId || url

  return {
    id,
    name:
      typeof value.name === 'string'
        ? value.name
        : typeof value.filename === 'string'
          ? value.filename
          : uploadedId || url,
    size: typeof value.size === 'number' ? value.size : 0,
    type: typeof value.mime_type === 'string' ? value.mime_type : supportFileType,
    progress: 100,
    transferMethod,
    supportFileType,
    uploadedId: uploadedId || undefined,
    url: url || undefined,
    isRemote: transferMethod === TransferMethod.remote_url,
  }
}

const toFileEntities = (value: unknown): FileEntity[] => {
  const values = Array.isArray(value) ? value : value == null ? [] : [value]
  return values.map(toFileEntity).filter((file): file is FileEntity => file !== null)
}

const initialFormValues = (fields: FormField[], values?: Record<string, unknown>) => {
  const defaults: Record<string, unknown> = {}
  fields.forEach((field) => {
    if (field.default !== undefined && field.default !== null) defaults[field.key] = field.default
  })
  return { ...defaults, ...(values ?? {}) }
}

const setValidationError = (
  errors: Record<string, FormValidationError>,
  key: string,
  error: FormValidationError,
) => {
  errors[key] = error
  return false
}

const prepareFormValues = (fields: FormField[], values: Record<string, unknown>) => {
  const preparedValues = { ...values }
  const errors: Record<string, FormValidationError> = {}
  let valid = true

  fields.forEach((field) => {
    const value = values[field.key]

    if (field.type === 'bool' || field.type === 'checkbox') {
      preparedValues[field.key] = value === true
      return
    }

    if (field.type === 'number') {
      if (typeof value === 'number' && !Number.isNaN(value)) preparedValues[field.key] = value
      else if (typeof value === 'string' && value !== '') {
        const numberValue = Number(value)
        if (!Number.isNaN(numberValue)) preparedValues[field.key] = numberValue
        else {
          delete preparedValues[field.key]
          valid = setValidationError(errors, field.key, 'invalid-number')
        }
      } else delete preparedValues[field.key]
      if (!(field.key in preparedValues) && field.required && !errors[field.key])
        valid = setValidationError(errors, field.key, 'required')
      return
    }

    if (field.type === 'json' || field.type === 'json_object') {
      if (typeof value === 'string') {
        if (value.trim() === '') {
          delete preparedValues[field.key]
          if (field.required) valid = setValidationError(errors, field.key, 'required')
          return
        }

        try {
          const parsed = JSON.parse(value) as unknown
          if (field.type === 'json_object' && !isRecord(parsed)) {
            valid = setValidationError(errors, field.key, 'invalid-json-object')
            delete preparedValues[field.key]
            return
          }
          preparedValues[field.key] = parsed
        } catch {
          valid = setValidationError(errors, field.key, 'invalid-json')
          delete preparedValues[field.key]
        }
      } else if (field.type === 'json_object' && value != null && !isRecord(value)) {
        valid = setValidationError(errors, field.key, 'invalid-json-object')
        delete preparedValues[field.key]
      } else if (value == null) {
        delete preparedValues[field.key]
        if (field.required) valid = setValidationError(errors, field.key, 'required')
      }
      return
    }

    if (FILE_FIELD_TYPES.has(field.type)) {
      const files = toFileEntities(value)
      if (!files.every(fileIsUploaded)) valid = false

      const processedFiles = getProcessedFiles(files.filter(fileIsUploaded))
      const fileLimit = MULTI_FILE_FIELD_TYPES.has(field.type)
        ? (field.number_limits ?? field.max_length)
        : 1
      if (processedFiles.length === 0 && field.required)
        valid = setValidationError(errors, field.key, 'required')
      if (fileLimit && processedFiles.length > fileLimit)
        valid = setValidationError(errors, field.key, 'max-files')
      if (MULTI_FILE_FIELD_TYPES.has(field.type)) {
        if (processedFiles.length > 0) preparedValues[field.key] = processedFiles
        else delete preparedValues[field.key]
      } else if (processedFiles.length > 0) preparedValues[field.key] = processedFiles[0]
      else delete preparedValues[field.key]
      return
    }

    if (value == null || (typeof value === 'string' && value.trim() === '')) {
      delete preparedValues[field.key]
      if (field.required) valid = setValidationError(errors, field.key, 'required')
      return
    }

    if (typeof value !== 'string') {
      delete preparedValues[field.key]
      valid = setValidationError(errors, field.key, 'invalid-value')
      return
    }

    if (field.type === 'select' && !(field.options ?? []).includes(value)) {
      delete preparedValues[field.key]
      valid = setValidationError(errors, field.key, 'invalid-option')
      return
    }

    if (field.max_length && value.length > field.max_length)
      valid = setValidationError(errors, field.key, 'max-length')
  })

  return { errors, preparedValues, valid }
}

const Thinking = ({ item }: { item?: Extract<ConversationItem, { kind: 'assistant_turn' }> }) => {
  const { t } = useTranslation()
  const steps = item?.payload.trace.steps ?? []

  return (
    <details className="group min-h-8" open={steps.some((step) => step.state === 'active')}>
      <summary className="flex h-8 cursor-pointer list-none items-center gap-2 text-[13px] leading-4 font-medium text-text-tertiary outline-hidden focus-visible:ring-1 focus-visible:ring-state-accent-solid">
        <span aria-hidden className="i-custom-public-app-builder-thinking size-[18px] shrink-0" />
        <span>{t(($) => $['difyBuilder.thinking'], { ns: 'workflow' })}</span>
        <span className="grow" />
        {steps.length > 0 && (
          <span
            aria-hidden
            className="i-ri-arrow-right-s-line size-4 text-text-tertiary transition-transform group-open:rotate-90"
          />
        )}
      </summary>
      {steps.length > 0 && (
        <ol className="ml-5 space-y-1 border-l border-divider-subtle py-1 pl-3 text-xs text-text-tertiary">
          {steps.map((step) => (
            <li key={step.id} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn(
                  'size-1.5 rounded-full bg-text-quaternary',
                  step.state === 'active' &&
                    'animate-pulse bg-text-accent motion-reduce:animate-none',
                  step.state === 'done' && 'bg-text-success',
                )}
              />
              <span>{step.label}</span>
            </li>
          ))}
        </ol>
      )}
    </details>
  )
}

const FormCard = ({
  item,
  busy,
  invalidated,
  onActionPayloadChange,
  onActionValidityChange,
}: {
  item: Extract<ConversationItem, { kind: 'form' }>
  busy: boolean
  invalidated: boolean
  onActionPayloadChange: ActionPayloadChange
  onActionValidityChange?: ActionValidityChange
}) => {
  const { t } = useTranslation()
  const fileUploadConfig = useStore((state) => state.fileUploadConfig)
  const errorId = useId()
  const fields = item.payload.fields ?? EMPTY_FORM_FIELDS
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    initialFormValues(fields, item.payload.values),
  )
  const actionId =
    item.payload.variant === 'build_requirements'
      ? 'submit_requirements'
      : item.payload.variant === 'edit_rules'
        ? 'submit_edit_rules'
        : 'provide_testdata'
  const frozen = busy || invalidated || item.payload.frozen === true
  const prepared = useMemo(() => prepareFormValues(fields, values), [fields, values])
  const actionPayloadChangeRef = useRef(onActionPayloadChange)
  const actionValidityChangeRef = useRef(onActionValidityChange)

  useEffect(() => {
    actionPayloadChangeRef.current = onActionPayloadChange
  }, [onActionPayloadChange])

  useEffect(() => {
    actionValidityChangeRef.current = onActionValidityChange
  }, [onActionValidityChange])

  useEffect(() => {
    if (invalidated || item.payload.frozen === true) return

    actionPayloadChangeRef.current(
      actionId,
      actionId === 'provide_testdata'
        ? { mode: 'provide', inputs: prepared.preparedValues }
        : prepared.preparedValues,
    )
    actionValidityChangeRef.current?.(actionId, prepared.valid)
  }, [actionId, invalidated, item.payload.frozen, prepared])

  const updateValues = (key: string, value: unknown) => {
    setValues((current) => ({ ...current, [key]: value }))
  }

  const validationMessage = (field: FormField, error: FormValidationError) => {
    if (error === 'required')
      return t(($) => $['errorMsg.fieldRequired'], { ns: 'workflow', field: field.label })
    if (error === 'invalid-json-object')
      return `${field.label}: ${t(($) => $['nodes.agent.outputVars.defaultValueObjectInvalid'], { ns: 'workflow' })}`
    if (error === 'invalid-json')
      return t(($) => $['errorMsg.invalidJson'], { ns: 'workflow', field: field.label })
    if (error === 'invalid-number') return `${field.label} must be a number.`
    if (error === 'invalid-option') return `${field.label} must use an available option.`
    if (error === 'max-files')
      return `${field.label} accepts at most ${field.number_limits ?? field.max_length} files.`
    if (error === 'max-length')
      return `${field.label} must be ${field.max_length} characters or less.`
    return `${field.label} has an invalid value.`
  }

  return (
    <DifyBuilderCardShell invalidated={invalidated}>
      <div className="flex flex-col gap-3">
        {fields.map((field, index) => {
          const validationError = prepared.errors[field.key]
          const fieldErrorId = `${errorId}-${index}-error`
          if (field.type === 'bool' || field.type === 'checkbox') {
            return (
              <label
                key={field.key}
                className="flex items-center gap-2 py-1 system-xs-regular text-text-secondary"
              >
                <input
                  name={field.key}
                  type="checkbox"
                  checked={values[field.key] === true}
                  disabled={frozen}
                  aria-required={field.required || undefined}
                  onChange={(event) => updateValues(field.key, event.target.checked)}
                />
                <span>
                  {field.label}
                  {field.required && <span aria-hidden> *</span>}
                </span>
              </label>
            )
          }

          if (FILE_FIELD_TYPES.has(field.type)) {
            const files = toFileEntities(values[field.key])
            const configuredFileTypes = (field.allowed_file_types ?? []).filter(
              (type): type is SupportUploadFileTypes => FILE_TYPE_VALUES.has(type),
            )
            const configuredUploadMethods = (field.allowed_file_upload_methods ?? []).filter(
              (method): method is TransferMethod => FILE_UPLOAD_METHOD_VALUES.has(method),
            )
            const allowedFileTypes =
              configuredFileTypes.length > 0 ? configuredFileTypes : DEFAULT_ALLOWED_FILE_TYPES
            const allowedFileExtensions =
              configuredFileTypes.length > 0
                ? (field.allowed_file_extensions ?? [])
                : DEFAULT_ALLOWED_FILE_EXTENSIONS
            const allowedFileUploadMethods =
              configuredUploadMethods.length > 0
                ? configuredUploadMethods
                : DEFAULT_ALLOWED_FILE_UPLOAD_METHODS
            return (
              <fieldset
                key={field.key}
                aria-label={field.label}
                aria-required={field.required || undefined}
                aria-invalid={validationError ? true : undefined}
                aria-describedby={validationError ? fieldErrorId : undefined}
                className="m-0 min-w-0 border-0 p-0"
                disabled={frozen}
              >
                <legend className="mb-1 system-xs-medium text-text-secondary">
                  {field.label}
                  {field.required && <span aria-hidden> *</span>}
                </legend>
                <FileUploaderInAttachmentWrapper
                  value={files}
                  isDisabled={frozen}
                  fileConfig={{
                    allowed_file_types: allowedFileTypes,
                    allowed_file_extensions: allowedFileExtensions,
                    allowed_file_upload_methods: allowedFileUploadMethods,
                    number_limits: MULTI_FILE_FIELD_TYPES.has(field.type)
                      ? (field.number_limits ??
                        field.max_length ??
                        fileUploadConfig?.workflow_file_upload_limit ??
                        MAX_FILE_UPLOAD_LIMIT)
                      : 1,
                    fileUploadConfig,
                  }}
                  onChange={(files) =>
                    updateValues(
                      field.key,
                      MULTI_FILE_FIELD_TYPES.has(field.type) ? files : files[0],
                    )
                  }
                />
                {validationError && (
                  <span
                    id={fieldErrorId}
                    role="alert"
                    className="mt-1 block system-xs-regular text-text-destructive"
                  >
                    {validationMessage(field, validationError)}
                  </span>
                )}
              </fieldset>
            )
          }

          const rawValue = values[field.key]
          const value =
            typeof rawValue === 'string' || typeof rawValue === 'number'
              ? String(rawValue)
              : rawValue == null
                ? ''
                : JSON.stringify(rawValue)
          return (
            <label
              key={field.key}
              className="flex flex-col gap-1 system-xs-medium text-text-secondary"
            >
              <span>
                {field.label}
                {field.type === 'number' && field.unit ? ` (${field.unit})` : null}
                {field.required && <span aria-hidden> *</span>}
              </span>
              {field.type === 'select' ? (
                <select
                  name={field.key}
                  value={value}
                  disabled={frozen}
                  required={field.required}
                  aria-invalid={validationError ? true : undefined}
                  aria-describedby={validationError ? fieldErrorId : undefined}
                  className="h-8 rounded-lg border border-components-input-border-active bg-components-input-bg-normal px-2 system-xs-regular text-text-primary outline-hidden focus-visible:ring-1 focus-visible:ring-state-accent-solid"
                  onChange={(event) => updateValues(field.key, event.target.value)}
                >
                  {!(field.options ?? []).includes('') && (
                    <option value="">{field.placeholder ?? ''}</option>
                  )}
                  {(field.options ?? []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : ['textarea', 'paragraph', 'json', 'json_object'].includes(field.type) ? (
                <textarea
                  name={field.key}
                  value={value}
                  disabled={frozen}
                  required={field.required}
                  maxLength={field.max_length ?? undefined}
                  placeholder={field.placeholder ?? undefined}
                  aria-invalid={validationError ? true : undefined}
                  aria-describedby={validationError ? fieldErrorId : undefined}
                  className="min-h-18 resize-y rounded-lg border border-components-input-border-active bg-components-input-bg-normal p-2 system-xs-regular text-text-primary outline-hidden focus-visible:ring-1 focus-visible:ring-state-accent-solid"
                  onChange={(event) => updateValues(field.key, event.target.value)}
                />
              ) : (
                <input
                  name={field.key}
                  type={field.type === 'number' || field.type === 'url' ? field.type : 'text'}
                  value={value}
                  disabled={frozen}
                  required={field.required}
                  maxLength={field.max_length ?? undefined}
                  placeholder={field.placeholder ?? undefined}
                  aria-invalid={validationError ? true : undefined}
                  aria-describedby={validationError ? fieldErrorId : undefined}
                  className="h-8 rounded-lg border border-components-input-border-active bg-components-input-bg-normal px-2 system-xs-regular text-text-primary outline-hidden focus-visible:ring-1 focus-visible:ring-state-accent-solid"
                  onChange={(event) =>
                    updateValues(
                      field.key,
                      field.type === 'number' && event.target.value !== ''
                        ? event.target.valueAsNumber
                        : event.target.value,
                    )
                  }
                />
              )}
              {validationError && (
                <span
                  id={fieldErrorId}
                  role="alert"
                  className="system-xs-regular text-text-destructive"
                >
                  {validationMessage(field, validationError)}
                </span>
              )}
              {field.hint && !validationError && (
                <span className="system-2xs-regular text-text-tertiary">{field.hint}</span>
              )}
            </label>
          )
        })}
      </div>
    </DifyBuilderCardShell>
  )
}

const ResourceCard = ({
  item,
  busy,
  invalidated,
  onActionPayloadChange,
}: {
  item: Extract<ConversationItem, { kind: 'resource_select' }>
  busy: boolean
  invalidated: boolean
  onActionPayloadChange: ActionPayloadChange
}) => {
  const { t } = useTranslation()
  const resources = item.payload.recommended ?? []
  const policies = item.payload.conflict_policy_options ?? []
  const [selected, setSelected] = useState(() => resources.map((resource) => resource.id))
  const [policy, setPolicy] = useState(
    () => policies.find((option) => option.recommended)?.id ?? 'ask',
  )
  const frozen = busy || invalidated

  const emitPayload = (resourceIds: string[], conflictPolicy: string) => {
    onActionPayloadChange('confirm_resources', {
      resource_ids: resourceIds,
      conflict_policy: conflictPolicy,
    })
  }

  return (
    <DifyBuilderCardShell invalidated={invalidated}>
      <div className="flex flex-col gap-2">
        {resources.map((resource) => (
          <div
            key={resource.id}
            className="flex items-start gap-2 rounded-lg bg-background-section p-2"
          >
            <input
              type="checkbox"
              aria-label={resource.label}
              checked={selected.includes(resource.id)}
              disabled={frozen}
              onChange={(event) => {
                const next = event.target.checked
                  ? [...selected, resource.id]
                  : selected.filter((id) => id !== resource.id)
                setSelected(next)
                emitPayload(next, policy)
              }}
            />
            <span className="min-w-0">
              <span className="block system-xs-medium text-text-primary">{resource.label}</span>
              <span className="block truncate system-2xs-regular text-text-tertiary">
                {resource.meta}
              </span>
            </span>
          </div>
        ))}
        {policies.length > 0 && (
          <label className="flex flex-col gap-1 system-xs-medium text-text-secondary">
            <span>{t(($) => $['difyBuilder.conflictPolicy'], { ns: 'workflow' })}</span>
            <select
              value={policy}
              disabled={frozen}
              className="h-8 rounded-lg border border-components-input-border-active bg-components-input-bg-normal px-2 system-xs-regular text-text-primary outline-hidden focus-visible:ring-1 focus-visible:ring-state-accent-solid"
              onChange={(event) => {
                setPolicy(event.target.value)
                emitPayload(selected, event.target.value)
              }}
            >
              {policies.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </DifyBuilderCardShell>
  )
}

const ConversationCard = ({
  item,
  busy,
  changesExpanded,
  invalidated,
  onActionPayloadChange,
  onActionValidityChange,
}: {
  item: ConversationItem
  busy: boolean
  changesExpanded: boolean
  invalidated: boolean
  onActionPayloadChange: ActionPayloadChange
  onActionValidityChange?: ActionValidityChange
}) => {
  const { t } = useTranslation()

  if (item.kind === 'user' || item.kind === 'decision') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[316px] rounded-2xl bg-background-default-dimmed px-4 py-3 text-[13px] leading-4 whitespace-pre-wrap text-text-primary">
          {item.payload.text}
        </div>
      </div>
    )
  }

  if (item.kind === 'assistant_turn') {
    if (!item.payload.reply_text) return invalidated ? null : <Thinking item={item} />
    return (
      <div className="px-1 text-sm leading-5 tracking-[-0.07px] whitespace-pre-wrap text-text-primary">
        {item.payload.reply_text}
      </div>
    )
  }

  if (item.kind === 'notice') {
    return (
      <div className="rounded-lg bg-background-section px-3 py-2 system-xs-regular text-text-tertiary">
        {item.payload.text}
      </div>
    )
  }

  if (item.kind === 'form') {
    return (
      <FormCard
        item={item}
        busy={busy}
        invalidated={invalidated}
        onActionPayloadChange={onActionPayloadChange}
        onActionValidityChange={onActionValidityChange}
      />
    )
  }

  if (item.kind === 'resource_select') {
    return (
      <ResourceCard
        item={item}
        busy={busy}
        invalidated={invalidated}
        onActionPayloadChange={onActionPayloadChange}
      />
    )
  }

  if (item.kind === 'run_context') {
    return (
      <DifyBuilderCardShell invalidated={invalidated} tone="error">
        <div className="system-xs-semibold text-text-primary">
          {item.payload.title || t(($) => $['difyBuilder.failedRun'], { ns: 'workflow' })}
        </div>
        {!!item.payload.message && (
          <div className="mt-1 system-xs-regular text-text-secondary">{item.payload.message}</div>
        )}
        <div className="mt-1 truncate font-mono text-[11px] text-text-tertiary">
          {item.payload.run_id}
        </div>
      </DifyBuilderCardShell>
    )
  }

  if (item.kind === 'preflight_context') {
    return (
      <DifyBuilderCardShell invalidated={invalidated} tone="warning">
        <div className="system-xs-semibold text-text-primary">
          {t(($) => $['difyBuilder.checklistIssues'], { ns: 'workflow' })}
        </div>
        {(item.payload.issues ?? []).map((issue) => (
          <div
            key={`${issue.node_id}-${issue.label}`}
            className="mt-1 system-xs-regular text-text-secondary"
          >
            {issue.label}
          </div>
        ))}
      </DifyBuilderCardShell>
    )
  }

  if (item.kind === 'plan') {
    return (
      <DifyBuilderCardShell invalidated={invalidated}>
        <div className="system-sm-semibold text-text-primary">{item.payload.title}</div>
        <ol className="mt-2 list-decimal space-y-1 pl-4 system-xs-regular text-text-secondary">
          {(item.payload.items ?? []).map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ol>
      </DifyBuilderCardShell>
    )
  }

  if (item.kind === 'challenge' || item.kind === 'error') {
    return (
      <DifyBuilderCardShell
        invalidated={invalidated}
        tone={item.kind === 'error' ? 'error' : 'warning'}
      >
        <div className="system-xs-semibold text-text-primary">{item.payload.title}</div>
        <div className="mt-1 system-xs-regular text-text-secondary">{item.payload.body}</div>
      </DifyBuilderCardShell>
    )
  }

  if (item.kind === 'change_set') {
    return (
      <DifyBuilderCardShell invalidated={invalidated}>
        <div className="flex items-center justify-between">
          <span className="system-xs-semibold text-text-primary">
            {item.payload.scope || t(($) => $['difyBuilder.changes'], { ns: 'workflow' })}
          </span>
          <span className="bg-components-badge-gray-bg rounded-md px-1.5 py-0.5 system-2xs-medium text-text-tertiary">
            {item.payload.count}
          </span>
        </div>
        {(changesExpanded || item.payload.full_diff_open) && (
          <ul className="mt-2 list-disc space-y-1 pl-4 system-xs-regular text-text-secondary">
            {item.payload.changes.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        )}
      </DifyBuilderCardShell>
    )
  }

  if (item.kind === 'test_result') {
    return (
      <DifyBuilderCardShell
        invalidated={invalidated}
        tone={item.payload.tone === 'success' ? 'success' : 'neutral'}
      >
        <div className="system-xs-semibold text-text-primary">{item.payload.title}</div>
        <div className="mt-1 system-xs-regular text-text-tertiary">{item.payload.subtitle}</div>
        {!!item.payload.stats?.length && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            {item.payload.stats.map((stat) => (
              <div key={`${stat.label}-${stat.value}`}>
                <div className="system-sm-semibold text-text-primary">{stat.value}</div>
                <div className="system-2xs-regular text-text-tertiary">{stat.label}</div>
              </div>
            ))}
          </div>
        )}
      </DifyBuilderCardShell>
    )
  }

  if (item.kind === 'summary') {
    return (
      <DifyBuilderCardShell invalidated={invalidated}>
        {!!item.payload.title && (
          <div className="system-xs-semibold text-text-primary">{item.payload.title}</div>
        )}
        {(item.payload.items ?? []).map((text) => (
          <div key={text} className="mt-1 system-xs-regular text-text-secondary">
            {text}
          </div>
        ))}
        {(item.payload.rows ?? []).map((row) => (
          <div
            key={`${row.label}-${row.value}`}
            className="mt-1 flex justify-between gap-3 system-xs-regular"
          >
            <span className="text-text-tertiary">{row.label}</span>
            <span className="text-right text-text-secondary">{row.value}</span>
          </div>
        ))}
      </DifyBuilderCardShell>
    )
  }

  if (item.kind === 'checkpoint' || item.kind === 'publish' || item.kind === 'build_learning') {
    const label =
      item.kind === 'checkpoint'
        ? item.payload.label
        : item.kind === 'publish'
          ? item.payload.version
          : item.payload.state
    return (
      <DifyBuilderCardShell
        invalidated={invalidated}
        tone={item.kind === 'publish' ? 'success' : 'info'}
      >
        <div className="system-xs-medium text-text-secondary">{label}</div>
      </DifyBuilderCardShell>
    )
  }

  return null
}

export const DifyBuilderConversation = ({
  busy,
  changesExpanded,
  interrupted,
  items,
  onActionPayloadChange,
  onActionValidityChange,
}: {
  busy: boolean
  changesExpanded: boolean
  interrupted: boolean
  items: ConversationItem[]
  onActionPayloadChange: ActionPayloadChange
  onActionValidityChange?: ActionValidityChange
}) => {
  const { t } = useTranslation()
  const groups = useMemo(() => groupConversationItems(items), [items])
  const hasThinkingTurn = items.some(
    (item) => item.kind === 'assistant_turn' && !item.payload.reply_text,
  )

  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      {interrupted && (
        <div
          role="alert"
          className="rounded-lg bg-state-warning-hover px-3 py-2 system-xs-regular text-text-warning"
        >
          {t(($) => $['difyBuilder.interrupted'], { ns: 'workflow' })}
        </div>
      )}
      {groups.map((group) => {
        if (group.type === 'standalone') {
          return (
            <ConversationCard
              key={`${group.item.seq}-${group.item.kind}`}
              item={group.item}
              busy={busy}
              changesExpanded={changesExpanded}
              invalidated={false}
              onActionPayloadChange={onActionPayloadChange}
              onActionValidityChange={onActionValidityChange}
            />
          )
        }

        return (
          <div
            key={`${group.turn.seq}-${group.turn.kind}`}
            className={cn('flex flex-col gap-3', group.invalidated && 'opacity-70')}
          >
            {group.invalidated && (
              <div className="flex items-center gap-1.5 px-1 system-2xs-medium-uppercase text-text-tertiary">
                <span aria-hidden className="i-ri-history-line size-3.5" />
                <span>{t(($) => $['difyBuilder.invalidated'], { ns: 'workflow' })}</span>
              </div>
            )}
            <ConversationCard
              item={group.turn}
              busy={busy}
              changesExpanded={changesExpanded}
              invalidated={group.invalidated}
              onActionPayloadChange={onActionPayloadChange}
              onActionValidityChange={onActionValidityChange}
            />
            {group.cards.map((item) => (
              <ConversationCard
                key={`${item.seq}-${item.kind}`}
                item={item}
                busy={busy}
                changesExpanded={changesExpanded}
                invalidated={group.invalidated}
                onActionPayloadChange={onActionPayloadChange}
                onActionValidityChange={onActionValidityChange}
              />
            ))}
          </div>
        )
      })}
      {busy && !hasThinkingTurn && <Thinking />}
    </div>
  )
}
