import {
  isValidElement,
  memo,
  useCallback,
  useMemo,
} from 'react'
import { RiExternalLinkLine } from '@remixicon/react'
import type { AnyFieldApi } from '@tanstack/react-form'
import { useStore } from '@tanstack/react-form'
import cn from '@/utils/classnames'
import Input from '@/app/components/base/input'
import PureSelect from '@/app/components/base/select/pure'
import type { FormSchema } from '@/app/components/base/form/types'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import Radio from '@/app/components/base/radio'
import RadioE from '@/app/components/base/radio/ui'

export type BaseFieldProps = {
  fieldClassName?: string
  labelClassName?: string
  inputContainerClassName?: string
  inputClassName?: string
  formSchema: FormSchema
  field: AnyFieldApi
  disabled?: boolean
  onChange?: (field: string, value: any) => void
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
}: BaseFieldProps) => {
  const renderI18nObject = useRenderI18nObject()
  const {
    label,
    required,
    placeholder,
    options,
    labelClassName: formLabelClassName,
    disabled: formSchemaDisabled,
  } = formSchema
  const disabled = propsDisabled || formSchemaDisabled

  const memorizedLabel = useMemo(() => {
    if (isValidElement(label))
      return label

    if (typeof label === 'string')
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
  const optionValues = useStore(field.form.store, (s) => {
    const result: Record<string, any> = {}
    options?.forEach((option) => {
      if (option.show_on?.length) {
        option.show_on.forEach((condition) => {
          result[condition.variable] = s.values[condition.variable]
        })
      }
    })
    return result
  })
  const memorizedOptions = useMemo(() => {
    return options?.filter((option) => {
      if (!option.show_on || option.show_on.length === 0)
        return true

      return option.show_on.every((condition) => {
        const conditionValue = optionValues[condition.variable]
        return conditionValue === condition.value
      })
    }).map((option) => {
      return {
        label: typeof option.label === 'string' ? option.label : renderI18nObject(option.label),
        value: option.value,
      }
    }) || []
  }, [options, renderI18nObject, optionValues])
  const value = useStore(field.form.store, s => s.values[field.name])

  const handleChange = useCallback((value: any) => {
    field.handleChange(value)
    onChange?.(field.name, value)
  }, [field, onChange])

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
          formSchema.type === FormTypeEnum.textInput && (
            <Input
              id={field.name}
              name={field.name}
              className={cn(inputClassName)}
              value={value || ''}
              onChange={(e) => {
                handleChange(e.target.value)
              }}
              onBlur={field.handleBlur}
              disabled={disabled}
              placeholder={memorizedPlaceholder}
            />
          )
        }
        {
          formSchema.type === FormTypeEnum.secretInput && (
            <Input
              id={field.name}
              name={field.name}
              type='password'
              className={cn(inputClassName)}
              value={value || ''}
              onChange={e => handleChange(e.target.value)}
              onBlur={field.handleBlur}
              disabled={disabled}
              placeholder={memorizedPlaceholder}
              autoComplete={'new-password'}
            />
          )
        }
        {
          formSchema.type === FormTypeEnum.textNumber && (
            <Input
              id={field.name}
              name={field.name}
              type='number'
              className={cn(inputClassName)}
              value={value || ''}
              onChange={e => handleChange(e.target.value)}
              onBlur={field.handleBlur}
              disabled={disabled}
              placeholder={memorizedPlaceholder}
            />
          )
        }
        {
          formSchema.type === FormTypeEnum.select && (
            <PureSelect
              value={value}
              onChange={v => handleChange(v)}
              disabled={disabled}
              placeholder={memorizedPlaceholder}
              options={memorizedOptions}
              triggerPopupSameWidth
              popupProps={{
                className: 'max-h-[320px] overflow-y-auto',
              }}
            />
          )
        }
        {
          formSchema.type === FormTypeEnum.radio && (
            <div className={cn(
              memorizedOptions.length < 3 ? 'flex items-center space-x-2' : 'space-y-2',
            )}>
              {
                memorizedOptions.map(option => (
                  <div
                    key={option.value}
                    className={cn(
                      'system-sm-regular hover:bg-components-option-card-option-hover-bg hover:border-components-option-card-option-hover-border flex h-8 flex-[1] grow cursor-pointer items-center justify-center rounded-lg border border-components-option-card-option-border bg-components-option-card-option-bg p-2 text-text-secondary',
                      value === option.value && 'border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg text-text-primary shadow-xs',
                      disabled && 'cursor-not-allowed opacity-50',
                      inputClassName,
                    )}
                    onClick={() => !disabled && handleChange(option.value)}
                  >
                    {
                      formSchema.showRadioUI && (
                        <RadioE
                          className='mr-2'
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
          formSchema.type === FormTypeEnum.boolean && (
            <Radio.Group
              className='flex w-fit items-center'
              value={value}
              onChange={v => field.handleChange(v)}
            >
              <Radio value={true} className='!mr-1'>True</Radio>
              <Radio value={false}>False</Radio>
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
              {
                <RiExternalLinkLine className='ml-1 h-3 w-3' />
              }
            </a>
          )
        }
      </div>
    </div>
  )
}

export default memo(BaseField)
