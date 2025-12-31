import type { AnyFieldApi } from '@tanstack/react-form'
import type { FieldState, FormSchema, TypeWithI18N } from '@/app/components/base/form/types'
import { RiExternalLinkLine } from '@remixicon/react'
import { useStore } from '@tanstack/react-form'
import {
  isValidElement,
  memo,
  useCallback,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import CheckboxList from '@/app/components/base/checkbox-list'
import { FormItemValidateStatusEnum, FormTypeEnum } from '@/app/components/base/form/types'
import Input from '@/app/components/base/input'
import Radio from '@/app/components/base/radio'
import RadioE from '@/app/components/base/radio/ui'
import PureSelect from '@/app/components/base/select/pure'
import Tooltip from '@/app/components/base/tooltip'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import { useTriggerPluginDynamicOptions } from '@/service/use-triggers'
import { cn } from '@/utils/classnames'

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

const getTranslatedContent = ({ content, render }: {
  content: React.ReactNode | string | null | undefined | TypeWithI18N<string> | Record<string, string>
  render: (content: TypeWithI18N<string> | Record<string, string>) => string
}): string => {
  if (isValidElement(content) || typeof content === 'string')
    return content as string

  if (typeof content === 'object' && content !== null)
    return render(content as TypeWithI18N<string>)

  return ''
}

const VALIDATE_STATUS_STYLE_MAP: Record<FormItemValidateStatusEnum, { componentClassName: string, textClassName: string, infoFieldName: string }> = {
  [FormItemValidateStatusEnum.Error]: {
    componentClassName: 'border-components-input-border-destructive focus:border-components-input-border-destructive',
    textClassName: 'text-text-destructive',
    infoFieldName: 'errors',
  },
  [FormItemValidateStatusEnum.Warning]: {
    componentClassName: 'border-components-input-border-warning focus:border-components-input-border-warning',
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
  onChange?: (field: string, value: any) => void
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

  const [translatedLabel, translatedPlaceholder, translatedTooltip, translatedDescription, translatedHelp] = useMemo(() => {
    const results = [
      label,
      placeholder,
      tooltip,
      description,
      help,
    ].map(v => getTranslatedContent({ content: v, render: renderI18nObject }))
    if (!results[1])
      results[1] = t('placeholder.input', { ns: 'common' })
    return results
  }, [label, placeholder, tooltip, description, help, renderI18nObject])

  const watchedVariables = useMemo(() => {
    const variables = new Set<string>()

    for (const option of options || []) {
      for (const condition of option.show_on || [])
        variables.add(condition.variable)
    }

    return Array.from(variables)
  }, [options])

  const watchedValues = useStore(field.form.store, (s) => {
    const result: Record<string, any> = {}
    for (const variable of watchedVariables)
      result[variable] = s.values[variable]

    return result
  })

  const memorizedOptions = useMemo(() => {
    return options?.filter((option) => {
      if (!option.show_on?.length)
        return true

      return option.show_on.every((condition) => {
        return watchedValues[condition.variable] === condition.value
      })
    }).map((option) => {
      return {
        label: getTranslatedContent({ content: option.label, render: renderI18nObject }),
        value: option.value,
      }
    }) || []
  }, [options, renderI18nObject, watchedValues])

  const value = useStore(field.form.store, s => s.values[field.name])

  const { data: dynamicOptionsData, isLoading: isDynamicOptionsLoading, error: dynamicOptionsError } = useTriggerPluginDynamicOptions(
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
    if (!dynamicOptionsData?.options)
      return []
    return dynamicOptionsData.options.map(option => ({
      label: getTranslatedContent({ content: option.label, render: renderI18nObject }),
      value: option.value,
    }))
  }, [dynamicOptionsData, renderI18nObject])

  const handleChange = useCallback((value: any) => {
    field.handleChange(value)
    onChange?.(field.name, value)
  }, [field, onChange])

  return (
    <>
      <div className={cn(fieldClassName)}>
        <div className={cn(labelClassName, formLabelClassName)}>
          {translatedLabel}
          {
            required && !isValidElement(label) && (
              <span className="ml-1 text-text-destructive-secondary">*</span>
            )
          }
          {tooltip && (
            <Tooltip
              popupContent={<div className="w-[200px]">{translatedTooltip}</div>}
              triggerClassName="ml-0.5 w-4 h-4"
            />
          )}
        </div>
        <div className={cn(inputContainerClassName)}>
          {
            [FormTypeEnum.textInput, FormTypeEnum.secretInput, FormTypeEnum.textNumber].includes(formItemType) && (
              <Input
                id={field.name}
                name={field.name}
                className={cn(inputClassName, VALIDATE_STATUS_STYLE_MAP[fieldState?.validateStatus as FormItemValidateStatusEnum]?.componentClassName)}
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
            )
          }
          {
            formItemType === FormTypeEnum.select && !multiple && (
              <PureSelect
                value={value}
                onChange={v => handleChange(v)}
                disabled={disabled}
                placeholder={translatedPlaceholder}
                options={memorizedOptions}
                triggerPopupSameWidth
                popupProps={{
                  className: 'max-h-[320px] overflow-y-auto',
                }}
              />
            )
          }
          {
            formItemType === FormTypeEnum.checkbox /* && multiple */ && (
              <CheckboxList
                title={name}
                value={value}
                onChange={v => field.handleChange(v)}
                options={memorizedOptions}
                maxHeight="200px"
              />
            )
          }
          {
            formItemType === FormTypeEnum.dynamicSelect && (
              <PureSelect
                options={dynamicOptions}
                value={value}
                onChange={field.handleChange}
                disabled={disabled || isDynamicOptionsLoading}
                placeholder={
                  isDynamicOptionsLoading
                    ? t('dynamicSelect.loading', { ns: 'common' })
                    : translatedPlaceholder
                }
                {...(dynamicOptionsError
                  ? { popupProps: { title: t('dynamicSelect.error', { ns: 'common' }), titleClassName: 'text-text-destructive-secondary' } }
                  : (!dynamicOptions.length ? { popupProps: { title: t('dynamicSelect.noData', { ns: 'common' }) } } : {}))}
                triggerPopupSameWidth
                multiple={multiple}
              />
            )
          }
          {
            formItemType === FormTypeEnum.radio && (
              <div className={cn(
                memorizedOptions.length < 3 ? 'flex items-center space-x-2' : 'space-y-2',
              )}
              >
                {
                  memorizedOptions.map(option => (
                    <div
                      key={option.value}
                      className={cn(
                        'system-sm-regular hover:bg-components-option-card-option-hover-bg hover:border-components-option-card-option-hover-border flex h-8 flex-[1] grow cursor-pointer items-center justify-center gap-2 rounded-lg border border-components-option-card-option-border bg-components-option-card-option-bg p-2 text-text-secondary',
                        value === option.value && 'border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg text-text-primary shadow-xs',
                        disabled && 'cursor-not-allowed opacity-50',
                        inputClassName,
                      )}
                      onClick={() => !disabled && handleChange(option.value)}
                    >
                      {
                        formSchema.showRadioUI && (
                          <RadioE
                            className="mr-2"
                            isChecked={value === option.value}
                          />
                        )
                      }
                      {option.label}
                    </div>
                  ))
                }
              </div>
            )
          }
          {
            formItemType === FormTypeEnum.boolean && (
              <Radio.Group
                className="flex w-fit items-center"
                value={value}
                onChange={v => field.handleChange(v)}
              >
                <Radio value={true} className="!mr-1">True</Radio>
                <Radio value={false}>False</Radio>
              </Radio.Group>
            )
          }
          {fieldState?.validateStatus && [FormItemValidateStatusEnum.Error, FormItemValidateStatusEnum.Warning].includes(fieldState?.validateStatus) && (
            <div className={cn(
              'system-xs-regular mt-1 px-0 py-[2px]',
              VALIDATE_STATUS_STYLE_MAP[fieldState?.validateStatus].textClassName,
            )}
            >
              {fieldState?.[VALIDATE_STATUS_STYLE_MAP[fieldState?.validateStatus].infoFieldName as keyof FieldState]}
            </div>
          )}
        </div>
      </div>
      {description && (
        <div className="system-xs-regular mt-4 text-text-tertiary">
          {translatedDescription}
        </div>
      )}
      {
        url && (
          <a
            className="system-xs-regular mt-4 flex items-center text-text-accent"
            href={url}
            target="_blank"
          >
            <span className="break-all">
              {translatedHelp}
            </span>
            <RiExternalLinkLine className="ml-1 h-3 w-3 shrink-0" />
          </a>
        )
      }
    </>

  )
}

export default memo(BaseField)
