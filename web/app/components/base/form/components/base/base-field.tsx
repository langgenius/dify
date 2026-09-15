import type { AnyFieldApi } from '@tanstack/react-form'
import type { FieldState, FormSchema, TypeWithI18N } from '@/app/components/base/form/types'
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
  SelectValue,
} from '@langgenius/dify-ui/select'
import { useStore } from '@tanstack/react-form'
import { isValidElement, memo, useCallback, useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckboxList } from '@/app/components/base/checkbox-list'
import { FormItemValidateStatusEnum, FormTypeEnum } from '@/app/components/base/form/types'
import { Infotip } from '@/app/components/base/infotip'
import Input from '@/app/components/base/input'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import { useTriggerPluginDynamicOptions } from '@/service/use-triggers'

const getExtraProps = (type: FormTypeEnum) => {
  switch (type) {
    case FormTypeEnum.secretInput:
      return { type: 'password', autoComplete: 'new-password' }
    case FormTypeEnum.textNumber:
      return { type: 'number' }
    default:
      return { type: 'text' }
  }
}

const getTranslatedContent = ({
  content,
  render,
}: {
  content:
    | React.ReactNode
    | string
    | null
    | undefined
    | TypeWithI18N<string>
    | Record<string, string>
  render: (content: TypeWithI18N<string> | Record<string, string>) => string
}): string => {
  if (isValidElement(content) || typeof content === 'string') return content as string

  if (typeof content === 'object' && content !== null)
    return render(content as TypeWithI18N<string>)

  return ''
}

type SelectOption = {
  label: string
  value: string
}

const getSingleSelectValue = (value: unknown, options: SelectOption[]) => {
  return options.find((option) => option.value === value)?.value ?? null
}

const getSingleSelectLabel = (
  value: unknown,
  options: SelectOption[],
  placeholder: string | undefined,
) => {
  return options.find((option) => option.value === value)?.label ?? placeholder
}

const VALIDATE_STATUS_STYLE_MAP: Record<
  FormItemValidateStatusEnum,
  { componentClassName: string; textClassName: string; infoFieldName: string }
> = {
  [FormItemValidateStatusEnum.Error]: {
    componentClassName:
      'border-components-input-border-destructive focus:border-components-input-border-destructive',
    textClassName: 'text-text-destructive',
    infoFieldName: 'errors',
  },
  [FormItemValidateStatusEnum.Warning]: {
    componentClassName:
      'border-components-input-border-warning focus:border-components-input-border-warning',
    textClassName: 'text-text-warning',
    infoFieldName: 'warnings',
  },
  [FormItemValidateStatusEnum.Success]: {
    componentClassName: '',
    textClassName: '',
    infoFieldName: '',
  },
  [FormItemValidateStatusEnum.Validating]: {
    componentClassName: '',
    textClassName: '',
    infoFieldName: '',
  },
}

export type BaseFieldProps = {
  fieldClassName?: string
  labelClassName?: string
  inputContainerClassName?: string
  inputClassName?: string
  formSchema: FormSchema
  field: AnyFieldApi
  disabled?: boolean
  onChange?: (field: string, value: unknown) => void
  fieldState?: FieldState
}

const BaseField = ({
  fieldClassName,
  labelClassName,
  inputContainerClassName,
  inputClassName,
  formSchema,
  field,
  disabled: propsDisabled,
  onChange,
  fieldState,
}: BaseFieldProps) => {
  const renderI18nObject = useRenderI18nObject()
  const { t } = useTranslation()
  const {
    name,
    label,
    required,
    placeholder,
    options,
    labelClassName: formLabelClassName,
    disabled: formSchemaDisabled,
    type: formItemType,
    dynamicSelectParams,
    multiple = false,
    tooltip,
    showCopy,
    description,
    url,
    help,
  } = formSchema
  const disabled = propsDisabled || formSchemaDisabled
  const controlId = useId()
  const labelId = `${controlId}-label`
  const descriptionId = `${controlId}-description`
  const messageId = `${controlId}-message`
  const meta = useStore(field.form.store, (state) => state.fieldMeta[field.name])
  // Nonempty external errors take priority; clearing them restores client validation.
  const errors = fieldState?.errors?.length ? fieldState.errors : meta?.isTouched ? meta.errors : []
  const validateStatus =
    fieldState?.validateStatus ?? (errors?.length ? FormItemValidateStatusEnum.Error : undefined)
  const messages =
    validateStatus === FormItemValidateStatusEnum.Error
      ? errors
      : validateStatus === FormItemValidateStatusEnum.Warning
        ? fieldState?.warnings
        : undefined
  const hasMessage = !!messages?.length
  const controlProps = {
    'aria-describedby':
      [description && descriptionId, hasMessage && messageId].filter(Boolean).join(' ') ||
      undefined,
    'aria-invalid': validateStatus === FormItemValidateStatusEnum.Error || undefined,
    'aria-required': required || undefined,
  }
  const isDynamicSelect = formItemType === FormTypeEnum.dynamicSelect
  const isSelect = formItemType === FormTypeEnum.select || isDynamicSelect
  const isSingleControl = [
    FormTypeEnum.textInput,
    FormTypeEnum.secretInput,
    FormTypeEnum.textNumber,
  ].includes(formItemType)

  const [
    translatedLabel,
    translatedPlaceholder,
    translatedTooltip,
    translatedDescription,
    translatedHelp,
  ] = useMemo(() => {
    const results = [label, placeholder, tooltip, description, help].map((v) =>
      getTranslatedContent({ content: v, render: renderI18nObject }),
    )
    if (!results[1]) results[1] = t(($) => $['placeholder.input'], { ns: 'common' })
    return results
  }, [label, placeholder, tooltip, description, help, renderI18nObject, t])

  const watchedVariables = useMemo(() => {
    const variables = new Set<string>()

    for (const option of options || []) {
      for (const condition of option.show_on || []) variables.add(condition.variable)
    }

    return Array.from(variables)
  }, [options])

  const watchedValues = useStore(field.form.store, (s) => {
    const result: Record<string, unknown> = {}
    for (const variable of watchedVariables) result[variable] = s.values[variable]

    return result
  })

  const memorizedOptions = useMemo(() => {
    return (
      options
        ?.filter((option) => {
          if (!option.show_on?.length) return true

          return option.show_on.every((condition) => {
            return watchedValues[condition.variable] === condition.value
          })
        })
        .map((option) => {
          return {
            label: getTranslatedContent({ content: option.label, render: renderI18nObject }),
            value: option.value,
          }
        }) || []
    )
  }, [options, renderI18nObject, watchedValues])

  const value = useStore(field.form.store, (s) => s.values[field.name])
  const stringValue = typeof value === 'string' ? value : undefined
  const booleanValue = typeof value === 'boolean' ? value : undefined

  const {
    data: dynamicOptionsData,
    isLoading: isDynamicOptionsLoading,
    error: dynamicOptionsError,
  } = useTriggerPluginDynamicOptions(
    dynamicSelectParams || {
      plugin_id: '',
      provider: '',
      action: '',
      parameter: '',
      credential_id: '',
    },
    formItemType === FormTypeEnum.dynamicSelect,
  )

  const dynamicOptions = useMemo(() => {
    if (!dynamicOptionsData?.options) return []
    return dynamicOptionsData.options.map((option) => ({
      label: getTranslatedContent({ content: option.label, render: renderI18nObject }),
      value: option.value,
    }))
  }, [dynamicOptionsData, renderI18nObject])

  const handleChange = useCallback(
    (value: unknown) => {
      field.handleChange(value)
      onChange?.(field.name, value)
    },
    [field, onChange],
  )
  const dynamicPlaceholder = isDynamicOptionsLoading
    ? t(($) => $['dynamicSelect.loading'], { ns: 'common' })
    : translatedPlaceholder
  const dynamicNoticeTitle = dynamicOptionsError
    ? t(($) => $['dynamicSelect.error'], { ns: 'common' })
    : !dynamicOptions.length
      ? t(($) => $['dynamicSelect.noData'], { ns: 'common' })
      : null
  const dynamicNoticeClassName = dynamicOptionsError ? 'text-text-destructive-secondary' : undefined

  const selectOptions = isDynamicSelect ? dynamicOptions : memorizedOptions
  const selectPlaceholder = isDynamicSelect ? dynamicPlaceholder : translatedPlaceholder
  const handleSelectChange = isDynamicSelect ? field.handleChange : handleChange
  const selectDisabled = disabled || (isDynamicSelect && isDynamicOptionsLoading)

  const content = (
    <>
      <div className={cn(fieldClassName)}>
        <div className={cn(labelClassName, formLabelClassName)}>
          {isSelect ? (
            <SelectLabel className="inline p-0 text-inherit [font:inherit]">
              {translatedLabel || name}
            </SelectLabel>
          ) : isSingleControl ? (
            <label id={labelId} htmlFor={controlId}>
              {translatedLabel || name}
            </label>
          ) : (
            <span id={labelId}>{translatedLabel || name}</span>
          )}
          {required && !isValidElement(label) && (
            <span aria-hidden="true" className="ml-1 text-text-destructive-secondary">
              *
            </span>
          )}
          {translatedTooltip && (
            <Infotip aria-label={translatedTooltip} className="ml-0.5" popupClassName="w-[200px]">
              {translatedTooltip}
            </Infotip>
          )}
        </div>
        <div className={cn(inputContainerClassName)} data-form-field={field.name}>
          {[FormTypeEnum.textInput, FormTypeEnum.secretInput, FormTypeEnum.textNumber].includes(
            formItemType,
          ) && (
            <Input
              id={controlId}
              name={field.name}
              {...controlProps}
              className={cn(
                inputClassName,
                VALIDATE_STATUS_STYLE_MAP[validateStatus as FormItemValidateStatusEnum]
                  ?.componentClassName,
              )}
              value={value || ''}
              onChange={(e) => {
                handleChange(e.target.value)
              }}
              onBlur={field.handleBlur}
              disabled={disabled}
              placeholder={translatedPlaceholder}
              {...getExtraProps(formItemType)}
              showCopyIcon={showCopy}
            />
          )}
          {isSelect && (
            <>
              <SelectTrigger id={controlId} {...controlProps} className="px-2">
                {multiple ? (
                  <SelectValue<string, true> placeholder={selectPlaceholder}>
                    {(selectedValue) =>
                      selectedValue?.length
                        ? t(($) => $['dynamicSelect.selected'], {
                            ns: 'common',
                            count: selectedValue.length,
                          })
                        : selectPlaceholder
                    }
                  </SelectValue>
                ) : (
                  <SelectValue<string> placeholder={selectPlaceholder}>
                    {(nextValue) =>
                      getSingleSelectLabel(nextValue, selectOptions, selectPlaceholder)
                    }
                  </SelectValue>
                )}
              </SelectTrigger>
              <SelectContent
                className={cn('bg-components-panel-bg-blur', !isDynamicSelect && 'max-h-80')}
              >
                {isDynamicSelect && dynamicNoticeTitle && (
                  <div
                    className={cn(
                      'flex h-5.5 items-center px-3 system-xs-medium-uppercase text-text-tertiary',
                      dynamicNoticeClassName,
                    )}
                  >
                    {dynamicNoticeTitle}
                  </div>
                )}
                {selectOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <SelectItemText>{option.label}</SelectItemText>
                    <SelectItemIndicator />
                  </SelectItem>
                ))}
              </SelectContent>
            </>
          )}
          {formItemType === FormTypeEnum.checkbox /* && multiple */ && (
            <CheckboxList
              {...controlProps}
              aria-labelledby={labelId}
              name={field.name}
              title={name}
              value={value}
              onChange={(v) => field.handleChange(v)}
              options={memorizedOptions}
              maxHeight="200px"
            />
          )}
          {formItemType === FormTypeEnum.radio && (
            <Field name={name} className="contents">
              <Fieldset
                render={
                  <RadioGroup
                    {...controlProps}
                    aria-labelledby={labelId}
                    value={stringValue}
                    onValueChange={(optionValue) => handleChange(optionValue)}
                    className={cn(memorizedOptions.length >= 3 && 'flex-col items-stretch')}
                  />
                }
              >
                <FieldsetLegend className="sr-only">{translatedLabel || name}</FieldsetLegend>
                {memorizedOptions.map((option) => (
                  <FieldItem
                    key={option.value}
                    className={cn('min-w-0', memorizedOptions.length < 3 && 'flex-1 grow')}
                  >
                    <FieldLabel
                      className={cn(
                        'hover:bg-components-option-card-option-hover-bg hover:border-components-option-card-option-hover-border flex h-8 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-components-option-card-option-border bg-components-option-card-option-bg p-2 system-sm-regular text-text-secondary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-components-input-border-active',
                        value === option.value &&
                          'border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg text-text-primary shadow-xs',
                        disabled && 'cursor-not-allowed opacity-50',
                        inputClassName,
                      )}
                    >
                      {formSchema.showRadioUI && (
                        <Radio className="mr-2" value={option.value} disabled={disabled} />
                      )}
                      {!formSchema.showRadioUI && (
                        <Radio className="sr-only" value={option.value} disabled={disabled} />
                      )}
                      {option.label}
                    </FieldLabel>
                  </FieldItem>
                ))}
              </Fieldset>
            </Field>
          )}
          {formItemType === FormTypeEnum.boolean && (
            <Field name={name} className="contents">
              <Fieldset
                render={
                  <RadioGroup<boolean>
                    {...controlProps}
                    aria-labelledby={labelId}
                    className="w-fit gap-3"
                    value={booleanValue}
                    onValueChange={(v) => field.handleChange(v)}
                  />
                }
              >
                <FieldsetLegend className="sr-only">{translatedLabel || name}</FieldsetLegend>
                <FieldItem>
                  <FieldLabel className="flex items-center gap-1.5 system-sm-regular text-text-secondary">
                    <Radio value={true} />
                    True
                  </FieldLabel>
                </FieldItem>
                <FieldItem>
                  <FieldLabel className="flex items-center gap-1.5 system-sm-regular text-text-secondary">
                    <Radio value={false} />
                    False
                  </FieldLabel>
                </FieldItem>
              </Fieldset>
            </Field>
          )}
          {hasMessage && (
            <div
              id={messageId}
              className={cn(
                'mt-1 px-0 py-0.5 system-xs-regular',
                VALIDATE_STATUS_STYLE_MAP[validateStatus!].textClassName,
              )}
            >
              {messages
                .map((message) => (typeof message === 'string' ? message : message.message))
                .join(' ')}
            </div>
          )}
        </div>
      </div>
      {description && (
        <div id={descriptionId} className="mt-4 system-xs-regular text-text-tertiary">
          {translatedDescription}
        </div>
      )}
      {url && (
        <a
          className="mt-4 flex items-center system-xs-regular text-text-accent"
          href={url}
          target="_blank"
        >
          <span className="break-all">{translatedHelp}</span>
          <div className="ml-1 i-ri-external-link-line size-3 shrink-0" />
        </a>
      )}
    </>
  )

  if (!isSelect) return content

  return multiple ? (
    <Select<string, true>
      multiple
      items={selectOptions}
      value={Array.isArray(value) ? value : []}
      disabled={selectDisabled}
      onValueChange={handleSelectChange}
    >
      {content}
    </Select>
  ) : (
    <Select<string>
      items={selectOptions}
      value={getSingleSelectValue(value, selectOptions)}
      disabled={selectDisabled}
      onValueChange={(next) => {
        if (next == null) return
        handleSelectChange(next)
      }}
    >
      {content}
    </Select>
  )
}

export default memo(BaseField)
