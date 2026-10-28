import type {
  ConversationItem,
  DifyBuilderActionPayloadChange,
  DifyBuilderActionValidityChange,
  FormField,
} from '../types'
import type { FormValidationError } from './form-values'
import type { FileUpload } from '@/app/components/base/features/types'
import type { SupportUploadFileTypes } from '@/app/components/workflow/types'
import type { TransferMethod } from '@/types/app'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { Field, FieldDescription, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Input } from '@langgenius/dify-ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { memo, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileUploaderInAttachmentWrapper } from '@/app/components/base/file-uploader'
import { MAX_FILE_UPLOAD_LIMIT } from '@/app/components/base/file-uploader/constants'
import { useStore } from '@/app/components/workflow/store'
import { useBuilderText } from '../copy/use-builder-text'
import { useDifyBuilderInteractionLocale } from '../interactions/use-interaction-locale'
import {
  DEFAULT_ALLOWED_FILE_EXTENSIONS,
  DEFAULT_ALLOWED_FILE_TYPES,
  DEFAULT_ALLOWED_FILE_UPLOAD_METHODS,
  EMPTY_FORM_FIELDS,
  FILE_FIELD_TYPES,
  FILE_TYPE_VALUES,
  FILE_UPLOAD_METHOD_VALUES,
  getFormActionPayload,
  initialFormValues,
  MULTI_FILE_FIELD_TYPES,
  prepareFormValues,
  toFileEntities,
} from './form-values'

export const FormCard = memo(
  ({
    item,
    busy,
    formId,
    onActionPayloadChange,
    onActionValidityChange,
    onSubmit,
  }: {
    item: Extract<ConversationItem, { kind: 'form' }>
    busy: boolean
    formId?: string
    onActionPayloadChange: DifyBuilderActionPayloadChange
    onActionValidityChange?: DifyBuilderActionValidityChange
    onSubmit?: () => void
  }) => {
    const locale = useDifyBuilderInteractionLocale()
    const { t } = useTranslation(['common', 'difyBuilder'], {
      lng: locale,
    })
    const { renderText } = useBuilderText()
    const fileUploadConfig = useStore((state) => state.fileUploadConfig)
    const errorId = useId()
    const fields = item.payload.fields ?? EMPTY_FORM_FIELDS
    const [values, setValues] = useState<Record<string, unknown>>(() =>
      initialFormValues(fields, item.payload.values),
    )
    // Upload completions may share a batch or retain an earlier change callback.
    const latestValuesRef = useRef(values)
    const [changedFields, setChangedFields] = useState<Set<string>>(() => new Set())
    const [invalidSubmitAttempts, setInvalidSubmitAttempts] = useState(0)
    const formRef = useRef<HTMLFormElement>(null)
    const actionId =
      item.payload.variant === 'build_requirements'
        ? 'submit_requirements'
        : item.payload.variant === 'edit_rules'
          ? 'submit_edit_rules'
          : 'provide_testdata'
    const frozen = busy || item.payload.frozen === true
    const category = t(($) => $['cardCategory.form'], { ns: 'difyBuilder' })
    const prepared = useMemo(() => prepareFormValues(fields, values), [fields, values])
    const fileConfigs = useMemo(
      () =>
        new Map<string, FileUpload>(
          fields
            .filter((field) => FILE_FIELD_TYPES.has(field.type))
            .map((field) => {
              const configuredFileTypes = (field.allowed_file_types ?? []).filter(
                (type): type is SupportUploadFileTypes => FILE_TYPE_VALUES.has(type),
              )
              const configuredUploadMethods = (field.allowed_file_upload_methods ?? []).filter(
                (method): method is TransferMethod => FILE_UPLOAD_METHOD_VALUES.has(method),
              )
              return [
                field.key,
                {
                  allowed_file_types:
                    configuredFileTypes.length > 0
                      ? configuredFileTypes
                      : DEFAULT_ALLOWED_FILE_TYPES,
                  allowed_file_extensions:
                    configuredFileTypes.length > 0
                      ? (field.allowed_file_extensions ?? [])
                      : DEFAULT_ALLOWED_FILE_EXTENSIONS,
                  allowed_file_upload_methods:
                    configuredUploadMethods.length > 0
                      ? configuredUploadMethods
                      : DEFAULT_ALLOWED_FILE_UPLOAD_METHODS,
                  number_limits: MULTI_FILE_FIELD_TYPES.has(field.type)
                    ? (field.number_limits ??
                      field.max_length ??
                      fileUploadConfig?.workflow_file_upload_limit ??
                      MAX_FILE_UPLOAD_LIMIT)
                    : 1,
                  fileUploadConfig,
                },
              ]
            }),
        ),
      [fields, fileUploadConfig],
    )

    useLayoutEffect(() => {
      if (invalidSubmitAttempts === 0) return
      const invalidField = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
      const focusableSelector =
        'input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled), [tabindex]:not([tabindex="-1"])'
      const focusTarget = invalidField?.matches(focusableSelector)
        ? invalidField
        : invalidField?.querySelector<HTMLElement>(focusableSelector)
      focusTarget?.focus()
    }, [invalidSubmitAttempts])

    const updateValues = (key: string, value: unknown) => {
      const nextValues = { ...latestValuesRef.current, [key]: value }
      latestValuesRef.current = nextValues
      setChangedFields((current) => new Set(current).add(key))
      setValues(nextValues)
      if (item.payload.frozen === true) return
      const nextPrepared = prepareFormValues(fields, nextValues)
      onActionPayloadChange(
        actionId,
        getFormActionPayload(actionId, fields, nextPrepared.preparedValues),
      )
      onActionValidityChange?.(actionId, nextPrepared.valid)
    }

    const validationMessage = (field: FormField, error: FormValidationError) => {
      if (error === 'required')
        return t(($) => $['validation.fieldRequired'], {
          ns: 'difyBuilder',
          field: renderText(field.label),
        })
      if (error === 'invalid-json-object')
        return `${renderText(field.label)}: ${t(($) => $['validation.invalidJsonObject'], { ns: 'difyBuilder' })}`
      if (error === 'invalid-json')
        return t(($) => $['validation.invalidJson'], {
          ns: 'difyBuilder',
          field: renderText(field.label),
        })
      if (error === 'invalid-number')
        return t(($) => $['validation.invalidNumber'], {
          ns: 'difyBuilder',
        })
      if (error === 'invalid-option')
        return t(($) => $['validation.invalidOption'], { ns: 'difyBuilder' })
      if (error === 'max-files')
        return t(($) => $['validation.maxFiles'], {
          ns: 'difyBuilder',
          limit: field.number_limits ?? field.max_length ?? 1,
        })
      if (error === 'max-length')
        return t(($) => $['validation.maxLength'], {
          ns: 'difyBuilder',
          limit: field.max_length ?? 0,
        })
      return t(($) => $['validation.invalidValue'], { ns: 'difyBuilder' })
    }

    const form = (
      <form
        ref={formRef}
        id={formId}
        aria-label={category}
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          if (frozen) return
          if (!prepared.valid) {
            setInvalidSubmitAttempts((current) => current + 1)
            return
          }
          onSubmit?.()
        }}
      >
        {fields.map((field, index) => {
          const validationError =
            invalidSubmitAttempts > 0 || changedFields.has(field.key)
              ? prepared.errors[field.key]
              : undefined
          const fieldErrorId = `${errorId}-${index}-error`
          const labelContent = (
            <>
              {renderText(field.label)}
              {field.type === 'number' && field.unit ? ` (${field.unit})` : null}
              {field.required && <span aria-hidden> *</span>}
            </>
          )
          if (field.type === 'bool' || field.type === 'checkbox') {
            return (
              <Field
                key={field.key}
                name={field.key}
                disabled={frozen}
                invalid={Boolean(validationError)}
              >
                <FieldLabel className="flex items-center gap-2">
                  <Checkbox
                    name={field.key}
                    checked={values[field.key] === true}
                    disabled={frozen}
                    required={field.required}
                    aria-invalid={validationError ? true : undefined}
                    aria-describedby={validationError ? fieldErrorId : undefined}
                    onCheckedChange={(checked) => updateValues(field.key, checked)}
                  />
                  <span>{labelContent}</span>
                </FieldLabel>
                {validationError && (
                  <FieldError id={fieldErrorId} role="alert" match>
                    {validationMessage(field, validationError)}
                  </FieldError>
                )}
                {field.hint && !validationError && (
                  <FieldDescription>{renderText(field.hint)}</FieldDescription>
                )}
              </Field>
            )
          }

          if (FILE_FIELD_TYPES.has(field.type)) {
            const files = toFileEntities(values[field.key])
            return (
              <fieldset
                key={field.key}
                aria-label={renderText(field.label)}
                aria-required={field.required || undefined}
                aria-invalid={validationError ? true : undefined}
                aria-describedby={validationError ? fieldErrorId : undefined}
                className="m-0 min-w-0 border-0 p-0"
                disabled={frozen}
              >
                <legend className="mb-1 system-xs-medium text-text-secondary">
                  {renderText(field.label)}
                  {field.required && <span aria-hidden> *</span>}
                </legend>
                <FileUploaderInAttachmentWrapper
                  value={files}
                  isDisabled={frozen}
                  fileConfig={fileConfigs.get(field.key)!}
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

          if (field.type === 'select') {
            const emptyOptionLabel =
              renderText(field.placeholder) || t(($) => $['operation.clear'], { ns: 'common' })
            return (
              <Field
                key={field.key}
                name={field.key}
                disabled={frozen}
                invalid={Boolean(validationError)}
              >
                <Select<string>
                  name={field.key}
                  value={value === '' ? null : value}
                  disabled={frozen}
                  required={field.required}
                  onValueChange={(nextValue) => updateValues(field.key, nextValue ?? '')}
                >
                  <SelectLabel>{labelContent}</SelectLabel>
                  <SelectTrigger
                    aria-invalid={validationError ? true : undefined}
                    aria-describedby={validationError ? fieldErrorId : undefined}
                  >
                    <SelectValue placeholder={renderText(field.placeholder) || ''} />
                  </SelectTrigger>
                  <SelectContent>
                    {!(field.options ?? []).includes('') && (
                      <SelectItem value="">
                        <SelectItemText>{emptyOptionLabel}</SelectItemText>
                        <SelectItemIndicator />
                      </SelectItem>
                    )}
                    {(field.options ?? []).map((option) => (
                      <SelectItem key={option} value={option}>
                        <SelectItemText>{option || emptyOptionLabel}</SelectItemText>
                        <SelectItemIndicator />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {validationError && (
                  <FieldError id={fieldErrorId} role="alert" match>
                    {validationMessage(field, validationError)}
                  </FieldError>
                )}
                {field.hint && !validationError && (
                  <FieldDescription>{renderText(field.hint)}</FieldDescription>
                )}
              </Field>
            )
          }

          return (
            <Field
              key={field.key}
              name={field.key}
              disabled={frozen}
              invalid={Boolean(validationError)}
            >
              <FieldLabel>{labelContent}</FieldLabel>
              {['textarea', 'paragraph', 'json', 'json_object'].includes(field.type) ? (
                <Textarea
                  name={field.key}
                  value={value}
                  disabled={frozen}
                  required={field.required}
                  maxLength={field.max_length ?? undefined}
                  placeholder={renderText(field.placeholder) || undefined}
                  aria-invalid={validationError ? true : undefined}
                  aria-describedby={validationError ? fieldErrorId : undefined}
                  className="min-h-18 resize-y"
                  onValueChange={(nextValue) => updateValues(field.key, nextValue)}
                />
              ) : (
                <Input
                  name={field.key}
                  type={field.type === 'number' || field.type === 'url' ? field.type : 'text'}
                  value={value}
                  disabled={frozen}
                  required={field.required}
                  maxLength={field.max_length ?? undefined}
                  placeholder={renderText(field.placeholder) || undefined}
                  aria-invalid={validationError ? true : undefined}
                  aria-describedby={validationError ? fieldErrorId : undefined}
                  onValueChange={(nextValue) =>
                    updateValues(
                      field.key,
                      field.type === 'number' && nextValue !== '' ? Number(nextValue) : nextValue,
                    )
                  }
                />
              )}
              {validationError && (
                <FieldError id={fieldErrorId} role="alert" match>
                  {validationMessage(field, validationError)}
                </FieldError>
              )}
              {field.hint && !validationError && (
                <FieldDescription>{renderText(field.hint)}</FieldDescription>
              )}
            </Field>
          )
        })}
      </form>
    )

    return form
  },
)
