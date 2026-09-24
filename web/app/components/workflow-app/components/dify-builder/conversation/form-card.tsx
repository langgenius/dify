import type {
  ConversationItem,
  DifyBuilderActionPayloadChange,
  DifyBuilderActionValidityChange,
  FormField,
} from '../types'
import type { FormValidationError } from './form-values'
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
import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileUploaderInAttachmentWrapper } from '@/app/components/base/file-uploader'
import { MAX_FILE_UPLOAD_LIMIT } from '@/app/components/base/file-uploader/constants'
import { useStore } from '@/app/components/workflow/store'
import {
  DEFAULT_ALLOWED_FILE_EXTENSIONS,
  DEFAULT_ALLOWED_FILE_TYPES,
  DEFAULT_ALLOWED_FILE_UPLOAD_METHODS,
  EMPTY_FORM_FIELDS,
  FILE_FIELD_TYPES,
  FILE_TYPE_VALUES,
  FILE_UPLOAD_METHOD_VALUES,
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
    const { t } = useTranslation(['workflow', 'common', 'workflowAgent'])
    const fileUploadConfig = useStore((state) => state.fileUploadConfig)
    const errorId = useId()
    const fields = item.payload.fields ?? EMPTY_FORM_FIELDS
    const [values, setValues] = useState<Record<string, unknown>>(() =>
      initialFormValues(fields, item.payload.values),
    )
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
    const category = t(($) => $['difyBuilder.cardCategory.form'], { ns: 'workflow' })
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
      if (item.payload.frozen === true) return

      const payload = { ...prepared.preparedValues }
      if (actionId !== 'provide_testdata') {
        // Requirements and edit rules merge into existing values; null clears a field.
        fields.forEach(({ key }) => {
          if (!(key in payload)) payload[key] = null
        })
      }
      actionPayloadChangeRef.current(
        actionId,
        actionId === 'provide_testdata' ? { mode: 'provide', inputs: payload } : payload,
      )
      actionValidityChangeRef.current?.(actionId, prepared.valid)
    }, [actionId, fields, item.payload.frozen, prepared])

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
      setChangedFields((current) => new Set(current).add(key))
      setValues((current) => ({ ...current, [key]: value }))
    }

    const validationMessage = (field: FormField, error: FormValidationError) => {
      if (error === 'required')
        return t(($) => $['errorMsg.fieldRequired'], { ns: 'workflow', field: field.label })
      if (error === 'invalid-json-object')
        return `${field.label}: ${t(($) => $['nodes.agent.outputVars.defaultValueObjectInvalid'], { ns: 'workflowAgent' })}`
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

    const form = (
      <form
        ref={formRef}
        id={formId}
        aria-label={category}
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
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
              {field.label}
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
                  <FieldDescription>{field.hint}</FieldDescription>
                )}
              </Field>
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

          if (field.type === 'select') {
            const emptyOptionLabel =
              field.placeholder ?? t(($) => $['operation.clear'], { ns: 'common' })
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
                    <SelectValue placeholder={field.placeholder ?? ''} />
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
                  <FieldDescription>{field.hint}</FieldDescription>
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
                  placeholder={field.placeholder ?? undefined}
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
                  placeholder={field.placeholder ?? undefined}
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
              {field.hint && !validationError && <FieldDescription>{field.hint}</FieldDescription>}
            </Field>
          )
        })}
      </form>
    )

    return form
  },
)
