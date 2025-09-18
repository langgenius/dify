import type { FormSchema } from '@/app/components/base/form/types'
import { FormTypeEnum } from '@/app/components/base/form/types'
import Input from '@/app/components/base/input'
import Radio from '@/app/components/base/radio'
import RadioE from '@/app/components/base/radio/ui'
import { PortalSelect } from '@/app/components/base/select'
import PureSelect from '@/app/components/base/select/pure'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import { useTriggerPluginDynamicOptions } from '@/service/use-triggers'
import cn from '@/utils/classnames'
import { RiExternalLinkLine } from '@remixicon/react'
import type { AnyFieldApi } from '@tanstack/react-form'
import { useStore } from '@tanstack/react-form'
import {
  isValidElement,
  memo,
  useMemo,
} from 'react'

const getInputType = (type: FormTypeEnum) => {
  switch (type) {
    case FormTypeEnum.secretInput:
      return 'password'
    case FormTypeEnum.textNumber:
      return 'number'
    default:
      return 'text'
  }
}

export type BaseFieldProps = {
  fieldClassName?: string
  labelClassName?: string
  inputContainerClassName?: string
  inputClassName?: string
  formSchema: FormSchema
  field: AnyFieldApi
  disabled?: boolean
}

const BaseField = ({
  fieldClassName,
  labelClassName,
  inputContainerClassName,
  inputClassName,
  formSchema,
  field,
  disabled: propsDisabled,
}: BaseFieldProps) => {
  const renderI18nObject = useRenderI18nObject()
  const {
    label,
    required,
    placeholder,
    options,
    labelClassName: formLabelClassName,
    show_on = [],
    disabled: formSchemaDisabled,
    showRadioUI,
    type: formItemType,
    dynamicSelectParams,
  } = formSchema
  const disabled = propsDisabled || formSchemaDisabled

  const memorizedLabel = useMemo(() => {
    if (isValidElement(label) || typeof label === 'string')
      return label

    if (typeof label === 'object' && label !== null)
      return renderI18nObject(label as Record<string, string>)
  }, [label, renderI18nObject])

  const memorizedPlaceholder = useMemo(() => {
    if (typeof placeholder === 'string')
      return placeholder

    if (typeof placeholder === 'object' && placeholder !== null)
      return renderI18nObject(placeholder as Record<string, string>)
  }, [placeholder, renderI18nObject])

  const watchedVariables = useMemo(() => {
    const variables = new Set<string>()

    for (const option of options || []) {
      for (const condition of option.show_on || [])
        variables.add(condition.variable)
    }

    for (const condition of show_on || [])
      variables.add(condition.variable)

    return Array.from(variables)
  }, [options, show_on])

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
        label: typeof option.label === 'string' ? option.label : renderI18nObject(option.label),
        value: option.value,
      }
    }) || []
  }, [options, renderI18nObject, watchedValues])

  const value = useStore(field.form.store, s => s.values[field.name])

  const { data: dynamicOptionsData, isLoading: isDynamicOptionsLoading } = useTriggerPluginDynamicOptions(
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
      name: typeof option.label === 'string' ? option.label : renderI18nObject(option.label),
      value: option.value,
    }))
  }, [dynamicOptionsData, renderI18nObject])

  const show = useMemo(() => {
    return show_on.every((condition) => {
      return watchedValues[condition.variable] === condition.value
    })
  }, [watchedValues, show_on])

  const booleanRadioValue = useMemo(() => {
    if (value === null || value === undefined)
      return undefined
    return value ? 1 : 0
  }, [value])

  if (!show)
    return null

  return (
    <div className={cn(fieldClassName)}>
      <div className={cn(labelClassName, formLabelClassName)}>
        {memorizedLabel}
        {
          required && !isValidElement(label) && (
            <span className='ml-1 text-text-destructive-secondary'>*</span>
          )
        }
      </div>
      <div className={cn(inputContainerClassName)}>
        {
          [FormTypeEnum.textInput, FormTypeEnum.secretInput, FormTypeEnum.textNumber].includes(formItemType) && (
            <Input
              id={field.name}
              name={field.name}
              className={cn(inputClassName)}
              value={value || ''}
              onChange={e => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              disabled={disabled}
              placeholder={memorizedPlaceholder}
              type={getInputType(formItemType)}
            />
          )
        }
        {
          formItemType === FormTypeEnum.select && (
            <PureSelect
              value={value}
              onChange={v => field.handleChange(v)}
              disabled={disabled}
              placeholder={memorizedPlaceholder}
              options={memorizedOptions}
              triggerPopupSameWidth
            />
          )
        }
        {
          formItemType === FormTypeEnum.dynamicSelect && (
            <PortalSelect
              value={value}
              onSelect={(item: any) => field.handleChange(item.value)}
              readonly={disabled || isDynamicOptionsLoading}
              placeholder={
                isDynamicOptionsLoading
                  ? 'Loading options...'
                  : memorizedPlaceholder || 'Select an option'
              }
              items={dynamicOptions}
              popupClassName="z-[9999]"
            />
          )
        }
        {
          formItemType === FormTypeEnum.radio && (
            <div className={cn(
              memorizedOptions.length < 3 ? 'flex items-center space-x-2' : 'space-y-2',
            )}>
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
                    onClick={() => !disabled && field.handleChange(option.value)}
                  >
                    {showRadioUI && <RadioE isChecked={value === option.value} />}
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
              className='flex w-fit items-center gap-1'
              value={booleanRadioValue}
              onChange={val => field.handleChange(val === 1)}
            >
              <Radio value={1}>True</Radio>
              <Radio value={0}>False</Radio>
            </Radio.Group>
          )
        }
        {
          formSchema.url && (
            <a
              className='system-xs-regular mt-4 flex items-center text-text-accent'
              href={formSchema?.url}
              target='_blank'
            >
              <span className='break-all'>
                {renderI18nObject(formSchema?.help as any)}
              </span>
              <RiExternalLinkLine className='ml-1 h-3 w-3' />
            </a>
          )
        }
      </div>
    </div>
  )
}

export default memo(BaseField)
