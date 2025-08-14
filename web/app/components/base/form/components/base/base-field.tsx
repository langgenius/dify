import {
  isValidElement,
  memo,
  useCallback,
  useMemo,
} from 'react'
import {
  RiArrowDownSFill,
  RiDraftLine,
  RiExternalLinkLine,
  RiInputField,
} from '@remixicon/react'
import type { AnyFieldApi } from '@tanstack/react-form'
import { useStore } from '@tanstack/react-form'
import cn from '@/utils/classnames'
import Input from '@/app/components/base/input'
import PureSelect from '@/app/components/base/select/pure'
import type { FormSchema } from '@/app/components/base/form/types'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import RadioE from '@/app/components/base/radio/ui'
import Textarea from '@/app/components/base/textarea'
import PromptEditor from '@/app/components/base/prompt-editor'
import ModelParameterModal from '@/app/components/plugins/plugin-detail-panel/model-selector'
import ObjectValueList from '@/app/components/workflow/panel/chat-variable-panel/components/object-value-list'
import ArrayValueList from '@/app/components/workflow/panel/chat-variable-panel/components/array-value-list'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import Button from '@/app/components/base/button'

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
  disabled,
}: BaseFieldProps) => {
  const renderI18nObject = useRenderI18nObject()
  const {
    type: typeOrFn,
    label,
    required,
    placeholder,
    options,
    labelClassName: formLabelClassName,
    fieldClassName: formFieldClassName,
    inputContainerClassName: formInputContainerClassName,
    inputClassName: formInputClassName,
    show_on = [],
    url,
    help,
    selfFormProps,
    onChange,
  } = formSchema
  const type = typeof typeOrFn === 'function' ? typeOrFn(field.form) : typeOrFn

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
      if (!option.show_on?.length)
        return true

      return option.show_on.every((condition) => {
        const conditionValue = optionValues[condition.variable]
        return Array.isArray(condition.value) ? condition.value.includes(conditionValue) : conditionValue === condition.value
      })
    }).map((option) => {
      return {
        label: typeof option.label === 'string' ? option.label : renderI18nObject(option.label),
        value: option.value,
      }
    }) || []
  }, [options, renderI18nObject])
  const value = useStore(field.form.store, s => s.values[field.name])
  const values = useStore(field.form.store, (s) => {
    return (Array.isArray(show_on) ? show_on : show_on(field.form)).reduce((acc, condition) => {
      acc[condition.variable] = s.values[condition.variable]
      return acc
    }, {} as Record<string, any>)
  })
  const show = useMemo(() => {
    return (Array.isArray(show_on) ? show_on : show_on(field.form)).every((condition) => {
      const conditionValue = values[condition.variable]
      return Array.isArray(condition.value) ? condition.value.includes(conditionValue) : conditionValue === condition.value
    })
  }, [values, show_on, field.name])
  const handleChange = useCallback((value: any) => {
    field.handleChange(value)
    onChange?.(field.form, value)
  }, [field, onChange])

  if (!show)
    return null

  return (
    <div className={cn(fieldClassName, formFieldClassName)}>
      <div className={cn(labelClassName, formLabelClassName)}>
        {memorizedLabel}
        {
          required && !isValidElement(label) && (
            <span className='ml-1 text-text-destructive-secondary'>*</span>
          )
        }
        {
          type === FormTypeEnum.collapse && (
            <RiArrowDownSFill
              className={cn(
                'h-4 w-4',
                value && 'rotate-180',
              )}
              onClick={() => handleChange(!value)}
            />
          )
        }
        {
          type === FormTypeEnum.editMode && (
            <Button
              variant='ghost'
              size='small'
              className='text-text-tertiary'
              onClick={() => handleChange(!value)}
            >
              {value ? <RiInputField className='mr-1 h-3.5 w-3.5' /> : <RiDraftLine className='mr-1 h-3.5 w-3.5' />}
              {selfFormProps?.(field.form)?.editModeLabel}
            </Button>
          )
        }
      </div>
      <div className={cn(inputContainerClassName, formInputContainerClassName)}>
        {
          type === FormTypeEnum.textInput && (
            <Input
              id={field.name}
              name={field.name}
              className={cn(inputClassName, formInputClassName)}
              value={value || ''}
              onChange={e => handleChange(e.target.value)}
              onBlur={field.handleBlur}
              disabled={disabled}
              placeholder={memorizedPlaceholder}
            />
          )
        }
        {
          type === FormTypeEnum.secretInput && (
            <Input
              id={field.name}
              name={field.name}
              type='password'
              className={cn(inputClassName, formInputClassName)}
              value={value || ''}
              onChange={e => handleChange(e.target.value)}
              onBlur={field.handleBlur}
              disabled={disabled}
              placeholder={memorizedPlaceholder}
            />
          )
        }
        {
          type === FormTypeEnum.textNumber && (
            <Input
              id={field.name}
              name={field.name}
              type='number'
              className={cn(inputClassName, formInputClassName)}
              value={value || ''}
              onChange={e => handleChange(e.target.value)}
              onBlur={field.handleBlur}
              disabled={disabled}
              placeholder={memorizedPlaceholder}
            />
          )
        }
        {
          type === FormTypeEnum.select && (
            <PureSelect
              value={value}
              onChange={handleChange}
              disabled={disabled}
              placeholder={memorizedPlaceholder}
              options={memorizedOptions}
              triggerPopupSameWidth
            />
          )
        }
        {
          type === FormTypeEnum.radio && (
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
                      inputClassName,
                      formInputClassName,
                    )}
                    onClick={() => handleChange(option.value)}
                  >
                    {
                      selfFormProps?.(field.form)?.showRadioUI && (
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
          type === FormTypeEnum.textareaInput && (
            <Textarea
              className={cn(
                'min-h-[80px]',
                inputClassName,
                formInputClassName,
              )}
              value={value}
              placeholder={memorizedPlaceholder}
              onChange={e => handleChange(e.target.value)}
              onBlur={field.handleBlur}
              disabled={disabled}
            />
          )
        }
        {
          type === FormTypeEnum.promptInput && (
            <PromptEditor
              value={value}
              onChange={handleChange}
              onBlur={field.handleBlur}
              editable={!disabled}
              placeholder={memorizedPlaceholder}
              className={cn(
                'min-h-[80px]',
                inputClassName,
                formInputClassName,
              )}
            />
          )
        }
        {
          type === FormTypeEnum.objectList && (
            <ObjectValueList
              list={value}
              onChange={handleChange}
            />
          )
        }
        {
          type === FormTypeEnum.arrayList && (
            <ArrayValueList
              isString={selfFormProps?.(field.form)?.isString}
              list={value}
              onChange={handleChange}
            />
          )
        }
        {
          type === FormTypeEnum.jsonInput && (
            <div className='w-full rounded-[10px] bg-components-input-bg-normal py-2 pl-3 pr-1' style={{ height: selfFormProps?.(field.form)?.editorMinHeight }}>
              <CodeEditor
                isExpand
                noWrapper
                language={CodeLanguage.json}
                value={value}
                placeholder={<div className='whitespace-pre'>{selfFormProps?.(field.form)?.placeholder as string}</div>}
                onChange={handleChange}
              />
            </div>
          )
        }
        {
          type === FormTypeEnum.modelSelector && (
            <ModelParameterModal
              popupClassName='!w-[387px]'
              value={value}
              setModel={handleChange}
              readonly={disabled}
              scope={formSchema.scope}
              isAdvancedMode
            />
          )
        }
        {
          url && (
            <a
              className='system-xs-regular mt-4 flex items-center text-text-accent'
              href={url}
              target='_blank'
            >
              <span className='break-all'>
                {renderI18nObject(help as any)}
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
