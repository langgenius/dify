import CheckboxList from '@/app/components/base/checkbox-list'
import type { FieldState, FormSchema, TypeWithI18N } from '@/app/components/base/form/types'
import { FormItemValidateStatusEnum, FormTypeEnum } from '@/app/components/base/form/types'
import Input from '@/app/components/base/input'
import Radio from '@/app/components/base/radio'
import RadioE from '@/app/components/base/radio/ui'
import PureSelect from '@/app/components/base/select/pure'
import Tooltip from '@/app/components/base/tooltip'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import { useTriggerPluginDynamicOptions } from '@/service/use-triggers'
import cn from '@/utils/classnames'
import {
  RiArrowDownSFill,
  RiDraftLine,
  RiExternalLinkLine,
  RiInputField,
} from '@remixicon/react'
import type { AnyFieldApi } from '@tanstack/react-form'
import { useStore } from '@tanstack/react-form'
import {
  isValidElement,
  memo,
  useCallback,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
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
import Switch from '../../../switch'
import NodeSelector from '@/app/components/workflow/panel/chat-variable-panel/components/node-selector'

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
    dynamicSelectParams,
    multiple = false,
    tooltip,
    showCopy,
    description,
    url,
    help,
    type: typeOrFn,
    fieldClassName: formFieldClassName,
    inputContainerClassName: formInputContainerClassName,
    inputClassName: formInputClassName,
    selfFormProps,
    onChange: formOnChange,
  } = formSchema
  const formItemType = typeof typeOrFn === 'function' ? typeOrFn(field.form) : typeOrFn
  const disabled = propsDisabled || formSchemaDisabled

  const [translatedLabel, translatedPlaceholder, translatedTooltip, translatedDescription, translatedHelp] = useMemo(() => {
    const results = [
      label,
      placeholder,
      tooltip,
      description,
      help,
    ].map(v => getTranslatedContent({ content: v, render: renderI18nObject }))
    if (!results[1]) results[1] = t('common.placeholder.input')
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
        const conditionValue = watchedValues[condition.variable]
        return Array.isArray(condition.value) ? condition.value.includes(conditionValue) : conditionValue === condition.value
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
  }, [field, formOnChange, onChange, disabled])

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
          className={cn(formItemType === FormTypeEnum.collapse && 'cursor-pointer', labelClassName, formLabelClassName)}
          onClick={() => {
            if (formItemType === FormTypeEnum.collapse)
              handleChange(!value)
          }}
        >
          {translatedLabel}
          {
            required && !isValidElement(label) && (
              <span className='ml-1 text-text-destructive-secondary'>*</span>
            )
          }
          {
            formItemType === FormTypeEnum.collapse && (
              <RiArrowDownSFill
                className={cn(
                  'h-4 w-4 text-text-quaternary',
                  !value && '-rotate-90',
                )}
              />
            )
          }
          {
            formItemType === FormTypeEnum.editMode && (
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
          {tooltip && (
            <Tooltip
              popupContent={<div className='w-[200px]'>{translatedTooltip}</div>}
              triggerClassName='ml-0.5 w-4 h-4'
            />
          )}
        </div>
        <div className={cn(inputContainerClassName, formInputContainerClassName)}>
          {
            !selfProps?.withSlider && [FormTypeEnum.textInput, FormTypeEnum.secretInput, FormTypeEnum.textNumber].includes(formItemType) && (
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
            formItemType === FormTypeEnum.textNumber && selfProps?.withSlider && (
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
                  placeholder={translatedPlaceholder}
                />
              </div>
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
                maxHeight='200px'
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
                    ? t('common.dynamicSelect.loading')
                    : translatedPlaceholder
                }
                {...(dynamicOptionsError ? { popupProps: { title: t('common.dynamicSelect.error'), titleClassName: 'text-text-destructive-secondary' } }
                  : (!dynamicOptions.length ? { popupProps: { title: t('common.dynamicSelect.noData') } } : {}))}
                triggerPopupSameWidth
                multiple={multiple}
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
            formItemType === FormTypeEnum.textareaInput && (
              <Textarea
                className={cn(
                  'min-h-[80px]',
                  inputClassName,
                  formInputClassName,
                )}
                value={value}
                placeholder={translatedPlaceholder}
                onChange={e => handleChange(e.target.value)}
                onBlur={field.handleBlur}
                disabled={disabled}
              />
            )
          }
          {
            formItemType === FormTypeEnum.promptInput && (
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
                  placeholder={translatedPlaceholder || selfProps?.placeholder}
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
            formItemType === FormTypeEnum.objectList && (
              <ObjectValueList
                list={value}
                onChange={handleChange}
              />
            )
          }
          {
            formItemType === FormTypeEnum.arrayList && (
              <ArrayValueList
                isString={selfProps?.isString}
                list={value}
                onChange={handleChange}
              />
            )
          }
          {
            formItemType === FormTypeEnum.booleanList && (
              <ArrayBooleanValueList
                list={value}
                onChange={handleChange}
              />
            )
          }
          {
            formItemType === FormTypeEnum.jsonInput && (
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
            formItemType === FormTypeEnum.modelSelector && (
              <ModelParameterModal
                popupClassName='!w-[387px]'
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
            formItemType === FormTypeEnum.nodeSelector && (
              <NodeSelector
                value={value}
                onChange={handleChange}
              />
            )
          }
          {
            formItemType === FormTypeEnum.boolean && (
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
            formItemType === FormTypeEnum.switch && (
              <Switch
                defaultValue={value}
                onChange={handleChange}
              />
            )
          }
          {fieldState?.validateStatus && [FormItemValidateStatusEnum.Error, FormItemValidateStatusEnum.Warning].includes(fieldState?.validateStatus) && (
            <div className={cn(
              'system-xs-regular mt-1 px-0 py-[2px]',
              VALIDATE_STATUS_STYLE_MAP[fieldState?.validateStatus].textClassName,
            )}>
              {fieldState?.[VALIDATE_STATUS_STYLE_MAP[fieldState?.validateStatus].infoFieldName as keyof FieldState]}
            </div>
          )}
        </div>
      </div>
      {description && (
        <div className='system-xs-regular mt-4 text-text-tertiary'>
          {translatedDescription}
        </div>
      )}
      {
        url && (
          <a
            className='system-xs-regular mt-4 flex items-center text-text-accent'
            href={url}
            target='_blank'
          >
            <span className='break-all'>
              {translatedHelp}
            </span>
            <RiExternalLinkLine className='ml-1 h-3 w-3 shrink-0' />
          </a>
        )
      }
      {
        selfProps?.withBottomDivider && (
          <div className='h-px w-full bg-divider-subtle' />
        )
      }
    </>

  )
}

export default memo(BaseField)
