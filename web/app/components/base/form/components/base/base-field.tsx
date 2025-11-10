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
import Radio from '@/app/components/base/radio'
import RadioE from '@/app/components/base/radio/ui'
import Textarea from '@/app/components/base/textarea'
import PromptEditor from '@/app/components/base/prompt-editor'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import ObjectValueList from '@/app/components/workflow/panel/chat-variable-panel/components/object-value-list'
import ArrayValueList from '@/app/components/workflow/panel/chat-variable-panel/components/array-value-list'
import ArrayBooleanValueList from '@/app/components/workflow/panel/chat-variable-panel/components/array-bool-list'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import Button from '@/app/components/base/button'
import PromptGeneratorBtn from '@/app/components/workflow/nodes/llm/components/prompt-generator-btn'
import Slider from '@/app/components/base/slider'
import Tooltip from '@/app/components/base/tooltip'
import Switch from '../../../switch'
import NodeSelector from '@/app/components/workflow/panel/chat-variable-panel/components/node-selector'

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
    type: typeOrFn,
    label,
    required,
    placeholder,
    options,
    labelClassName: formLabelClassName,
    fieldClassName: formFieldClassName,
    inputContainerClassName: formInputContainerClassName,
    inputClassName: formInputClassName,
    url,
    help,
    selfFormProps,
    onChange: formOnChange,
    tooltip,
    disabled: formSchemaDisabled,
  } = formSchema
  const type = typeof typeOrFn === 'function' ? typeOrFn(field.form) : typeOrFn
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
  const memorizedTooltip = useMemo(() => {
    if (typeof tooltip === 'string')
      return tooltip

    if (typeof tooltip === 'object' && tooltip !== null)
      return renderI18nObject(tooltip as Record<string, string>)
  }, [tooltip, renderI18nObject])
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
        return Array.isArray(condition.value) ? condition.value.includes(conditionValue) : conditionValue === condition.value
      })
    }).map((option) => {
      return {
        label: typeof option.label === 'string' ? option.label : renderI18nObject(option.label),
        value: option.value,
      }
    }) || []
  }, [options, renderI18nObject, optionValues])
  const value = useStore(field.form.store, s => s.values[field.name])
  const booleanRadioValue = useMemo(() => {
    if (value === null || value === undefined)
      return undefined
    return value ? 1 : 0
  }, [value])
  const handleChange = useCallback((value: any) => {
    if (disabled)
      return

    field.handleChange(value)
    formOnChange?.(field.form, value)
    onChange?.(field.name, value)
  }, [field, onChange, disabled])

  const selfProps = typeof selfFormProps === 'function' ? selfFormProps(field.form) : selfFormProps

  return (
    <>
      {
        selfProps?.withTopDivider && (
          <div className='h-px w-full bg-divider-subtle' />
        )
      }
      <div className={cn(fieldClassName, formFieldClassName)}>
        <div
          className={cn(type === FormTypeEnum.collapse && 'cursor-pointer', labelClassName, formLabelClassName)}
          onClick={() => {
            if (type === FormTypeEnum.collapse)
              handleChange(!value)
          }}
        >
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
                  'h-4 w-4 text-text-quaternary',
                  !value && '-rotate-90',
                )}
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
                {selfProps?.editModeLabel}
              </Button>
            )
          }
          {
            memorizedTooltip && (
              <Tooltip
                popupContent={memorizedTooltip}
                triggerClassName='ml-1 w-4 h-4'
              />
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
            type === FormTypeEnum.textNumber && !selfProps?.withSlider && (
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
            type === FormTypeEnum.textNumber && selfProps?.withSlider && (
              <div className='flex items-center space-x-2'>
                <Slider
                  min={selfProps?.sliderMin}
                  max={selfProps?.sliderMax}
                  step={selfProps?.sliderStep}
                  value={value}
                  onChange={handleChange}
                  className={cn(selfProps.sliderClassName)}
                  trackClassName={cn(selfProps.sliderTrackClassName)}
                  thumbClassName={cn(selfProps.sliderThumbClassName)}
                />
                <Input
                  id={field.name}
                  name={field.name}
                  type='number'
                  className={cn('', inputClassName, formInputClassName)}
                  wrapperClassName={cn(selfProps.inputWrapperClassName)}
                  value={value || ''}
                  onChange={e => handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  disabled={disabled}
                  placeholder={memorizedPlaceholder}
                />
              </div>
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
                        disabled && 'cursor-not-allowed opacity-50',
                        inputClassName,
                        formInputClassName,
                      )}
                      onClick={() => handleChange(option.value)}
                    >
                      {
                        selfProps?.showRadioUI && (
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
              <div className={cn(
                'relative rounded-lg bg-components-input-bg-normal p-2',
                formInputContainerClassName,
              )}>
                {
                  selfProps?.enablePromptGenerator && (
                    <PromptGeneratorBtn
                      nodeId={selfProps?.nodeId}
                      editorId={selfProps?.editorId}
                      className='absolute right-0 top-[-26px]'
                      onGenerated={handleChange}
                      modelConfig={selfProps?.modelConfig}
                      currentPrompt={value}
                      isBasicMode={selfProps?.isBasicMode}
                    />
                  )
                }
                <PromptEditor
                  value={value}
                  onChange={handleChange}
                  onBlur={field.handleBlur}
                  editable={!disabled}
                  placeholder={memorizedPlaceholder || selfProps?.placeholder}
                  className={cn(
                    'min-h-[80px]',
                    inputClassName,
                    formInputClassName,
                  )}
                />
              </div>
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
                isString={selfProps?.isString}
                list={value}
                onChange={handleChange}
              />
            )
          }
          {
            type === FormTypeEnum.booleanList && (
              <ArrayBooleanValueList
                list={value}
                onChange={handleChange}
              />
            )
          }
          {
            type === FormTypeEnum.jsonInput && (
              <div className='w-full rounded-[10px] bg-components-input-bg-normal py-2 pl-3 pr-1' style={{ height: selfProps?.editorMinHeight }}>
                <CodeEditor
                  isExpand
                  noWrapper
                  language={CodeLanguage.json}
                  value={value}
                  placeholder={<div className='whitespace-pre'>{selfProps?.placeholder as string}</div>}
                  onChange={handleChange}
                />
              </div>
            )
          }
          {
            type === FormTypeEnum.modelSelector && (
              <ModelParameterModal
                popupClassName='!w-[387px]'
                mode={value?.mode}
                modelId={value?.name}
                provider={value?.provider}
                setModel={({ modelId, mode, provider }) => {
                  handleChange({
                    mode,
                    provider,
                    name: modelId,
                    completion_params: value?.completion_params,
                  })
                }}
                completionParams={value?.completion_params}
                onCompletionParamsChange={(params) => {
                  handleChange({
                    ...value,
                    completion_params: params,
                  })
                }}
                readonly={disabled}
                isAdvancedMode
                isInWorkflow
                hideDebugWithMultipleModel
              />
            )
          }
          {
            type === FormTypeEnum.nodeSelector && (
              <NodeSelector
                value={value}
                onChange={handleChange}
              />
            )
          }
          {
            type === FormTypeEnum.boolean && (
              <Radio.Group
                className={cn('flex w-full items-center space-x-1', inputClassName, formInputClassName)}
                value={booleanRadioValue}
                onChange={handleChange}
              >
                <Radio value={1} className='m-0 h-7 flex-1 justify-center p-0'>True</Radio>
                <Radio value={0} className='m-0 h-7 flex-1 justify-center p-0'>False</Radio>
              </Radio.Group>
            )
          }
          {
            type === FormTypeEnum.switch && (
              <Switch
                defaultValue={value}
                onChange={handleChange}
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
      {
        selfProps?.withBottomDivider && (
          <div className='h-px w-full bg-divider-subtle' />
        )
      }
    </>
  )
}

export default memo(BaseField)
