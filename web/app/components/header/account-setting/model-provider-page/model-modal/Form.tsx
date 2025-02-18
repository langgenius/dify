import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import { ValidatingTip } from '../../key-validator/ValidateStatus'
import type {
  CredentialFormSchema,
  CredentialFormSchemaNumberInput,
  CredentialFormSchemaRadio,
  CredentialFormSchemaSecretInput,
  CredentialFormSchemaSelect,
  CredentialFormSchemaTextInput,
  FormValue,
} from '../declarations'
import { FormTypeEnum } from '../declarations'
import { useLanguage } from '../hooks'
import Input from './Input'
import cn from '@/utils/classnames'
import { SimpleSelect } from '@/app/components/base/select'
import Tooltip from '@/app/components/base/tooltip'
import Radio from '@/app/components/base/radio'
import ModelParameterModal from '@/app/components/plugins/plugin-detail-panel/model-selector'
import ToolSelector from '@/app/components/plugins/plugin-detail-panel/tool-selector'
import MultipleToolSelector from '@/app/components/plugins/plugin-detail-panel/multiple-tool-selector'
import AppSelector from '@/app/components/plugins/plugin-detail-panel/app-selector'
import RadioE from '@/app/components/base/radio/ui'
import type {
  NodeOutPutVar,
} from '@/app/components/workflow/types'
import type { Node } from 'reactflow'

type FormProps<
  CustomFormSchema extends Omit<CredentialFormSchema, 'type'> & { type: string } = never,
> = {
  className?: string
  itemClassName?: string
  fieldLabelClassName?: string
  value: FormValue
  onChange: (val: FormValue) => void
  formSchemas: Array<CredentialFormSchema | CustomFormSchema>
  validating: boolean
  validatedSuccess?: boolean
  showOnVariableMap: Record<string, string[]>
  isEditMode: boolean
  isAgentStrategy?: boolean
  readonly?: boolean
  inputClassName?: string
  isShowDefaultValue?: boolean
  fieldMoreInfo?: (payload: CredentialFormSchema | CustomFormSchema) => ReactNode
  customRenderField?: (
    formSchema: CustomFormSchema,
    props: Omit<FormProps<CustomFormSchema>, 'override' | 'customRenderField'>
  ) => ReactNode
  // If return falsy value, this field will fallback to default render
  override?: [Array<FormTypeEnum>, (formSchema: CredentialFormSchema, props: Omit<FormProps<CustomFormSchema>, 'override' | 'customRenderField'>) => ReactNode]
  nodeId?: string
  nodeOutputVars?: NodeOutPutVar[],
  availableNodes?: Node[],
}

function Form<
  CustomFormSchema extends Omit<CredentialFormSchema, 'type'> & { type: string } = never,
>({
  className,
  itemClassName,
  fieldLabelClassName,
  value,
  onChange,
  formSchemas,
  validating,
  validatedSuccess,
  showOnVariableMap,
  isEditMode,
  isAgentStrategy = false,
  readonly,
  inputClassName,
  isShowDefaultValue = false,
  fieldMoreInfo,
  customRenderField,
  override,
  nodeId,
  nodeOutputVars,
  availableNodes,
}: FormProps<CustomFormSchema>) {
  const language = useLanguage()
  const [changeKey, setChangeKey] = useState('')
  const filteredProps: Omit<FormProps<CustomFormSchema>, 'override' | 'customRenderField'> = {
    className,
    itemClassName,
    fieldLabelClassName,
    value,
    onChange,
    formSchemas,
    validating,
    validatedSuccess,
    showOnVariableMap,
    isEditMode,
    readonly,
    inputClassName,
    isShowDefaultValue,
    fieldMoreInfo,
  }

  const handleFormChange = (key: string, val: string | boolean) => {
    if (isEditMode && (key === '__model_type' || key === '__model_name'))
      return

    setChangeKey(key)
    const shouldClearVariable: Record<string, string | undefined> = {}
    if (showOnVariableMap[key]?.length) {
      showOnVariableMap[key].forEach((clearVariable) => {
        const schema = formSchemas.find(it => it.variable === clearVariable)
        shouldClearVariable[clearVariable] = schema ? schema.default : undefined
      })
    }
    onChange({ ...value, [key]: val, ...shouldClearVariable })
  }

  const handleModelChanged = useCallback((key: string, model: any) => {
    const newValue = {
      ...value[key],
      ...model,
      type: FormTypeEnum.modelSelector,
    }
    onChange({ ...value, [key]: newValue })
  }, [onChange, value])

  const renderField = (formSchema: CredentialFormSchema | CustomFormSchema) => {
    const tooltip = formSchema.tooltip
    const tooltipContent = (tooltip && (
      <Tooltip
        popupContent={<div className='w-[200px]'>
          {tooltip[language] || tooltip.en_US}
        </div>}
        triggerClassName='ml-1 w-4 h-4'
        asChild={false} />
    ))
    if (override) {
      const [overrideTypes, overrideRender] = override
      if (overrideTypes.includes(formSchema.type as FormTypeEnum)) {
        const node = overrideRender(formSchema as CredentialFormSchema, filteredProps)
        if (node)
          return node
      }
    }

    if (formSchema.type === FormTypeEnum.textInput || formSchema.type === FormTypeEnum.secretInput || formSchema.type === FormTypeEnum.textNumber) {
      const {
        variable, label, placeholder, required, show_on,
      } = formSchema as (CredentialFormSchemaTextInput | CredentialFormSchemaSecretInput)

      if (show_on.length && !show_on.every(showOnItem => value[showOnItem.variable] === showOnItem.value))
        return null

      const disabled = readonly || (isEditMode && (variable === '__model_type' || variable === '__model_name'))
      return (
        <div key={variable} className={cn(itemClassName, 'py-3')}>
          <div className={cn(fieldLabelClassName, 'system-sm-semibold text-text-secondary flex items-center py-2')}>
            {label[language] || label.en_US}
            {required && (
              <span className='ml-1 text-red-500'>*</span>
            )}
            {tooltipContent}
          </div>
          <Input
            className={cn(inputClassName, `${disabled && 'cursor-not-allowed opacity-60'}`)}
            value={(isShowDefaultValue && ((value[variable] as string) === '' || value[variable] === undefined || value[variable] === null)) ? formSchema.default : value[variable]}
            onChange={val => handleFormChange(variable, val)}
            validated={validatedSuccess}
            placeholder={placeholder?.[language] || placeholder?.en_US}
            disabled={disabled}
            type={formSchema.type === FormTypeEnum.textNumber ? 'number' : 'text'}
            {...(formSchema.type === FormTypeEnum.textNumber ? { min: (formSchema as CredentialFormSchemaNumberInput).min, max: (formSchema as CredentialFormSchemaNumberInput).max } : {})} />
          {fieldMoreInfo?.(formSchema)}
          {validating && changeKey === variable && <ValidatingTip />}
        </div>
      )
    }

    if (formSchema.type === FormTypeEnum.radio) {
      const {
        options, variable, label, show_on, required,
      } = formSchema as CredentialFormSchemaRadio

      if (show_on.length && !show_on.every(showOnItem => value[showOnItem.variable] === showOnItem.value))
        return null

      const disabled = isEditMode && (variable === '__model_type' || variable === '__model_name')

      return (
        <div key={variable} className={cn(itemClassName, 'py-3')}>
          <div className={cn(fieldLabelClassName, 'system-sm-semibold text-text-secondary flex items-center py-2')}>
            {label[language] || label.en_US}
            {required && (
              <span className='ml-1 text-red-500'>*</span>
            )}
            {tooltipContent}
          </div>
          <div className={`grid-cols- grid${options?.length} gap-3`}>
            {options.filter((option) => {
              if (option.show_on.length)
                return option.show_on.every(showOnItem => value[showOnItem.variable] === showOnItem.value)

              return true
            }).map(option => (
              <div
                className={`
                    border-components-option-card-option-border bg-components-option-card-option-bg flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2
                    ${value[variable] === option.value && 'bg-components-option-card-option-selected-bg border-components-option-card-option-selected-border border-[1.5px] shadow-sm'}
                    ${disabled && '!cursor-not-allowed opacity-60'}
                  `}
                onClick={() => handleFormChange(variable, option.value)}
                key={`${variable}-${option.value}`}
              >
                <RadioE isChecked={value[variable] === option.value} />

                <div className='system-sm-regular text-text-secondary'>{option.label[language] || option.label.en_US}</div>
              </div>
            ))}
          </div>
          {fieldMoreInfo?.(formSchema)}
          {validating && changeKey === variable && <ValidatingTip />}
        </div>
      )
    }

    if (formSchema.type === FormTypeEnum.select) {
      const {
        options, variable, label, show_on, required, placeholder,
      } = formSchema as CredentialFormSchemaSelect

      if (show_on.length && !show_on.every(showOnItem => value[showOnItem.variable] === showOnItem.value))
        return null

      return (
        <div key={variable} className={cn(itemClassName, 'py-3')}>
          <div className={cn(fieldLabelClassName, 'system-sm-semibold text-text-secondary flex items-center py-2')}>
            {label[language] || label.en_US}

            {required && (
              <span className='ml-1 text-red-500'>*</span>
            )}
            {tooltipContent}
          </div>
          <SimpleSelect
            wrapperClassName='h-8'
            className={cn(inputClassName)}
            disabled={readonly}
            defaultValue={(isShowDefaultValue && ((value[variable] as string) === '' || value[variable] === undefined || value[variable] === null)) ? formSchema.default : value[variable]}
            items={options.filter((option) => {
              if (option.show_on.length)
                return option.show_on.every(showOnItem => value[showOnItem.variable] === showOnItem.value)

              return true
            }).map(option => ({ value: option.value, name: option.label[language] || option.label.en_US }))}
            onSelect={item => handleFormChange(variable, item.value as string)}
            placeholder={placeholder?.[language] || placeholder?.en_US} />
          {fieldMoreInfo?.(formSchema)}
          {validating && changeKey === variable && <ValidatingTip />}
        </div>
      )
    }

    if (formSchema.type === FormTypeEnum.boolean) {
      const {
        variable, label, show_on, required,
      } = formSchema as CredentialFormSchemaRadio

      if (show_on.length && !show_on.every(showOnItem => value[showOnItem.variable] === showOnItem.value))
        return null

      return (
        <div key={variable} className={cn(itemClassName, 'py-3')}>
          <div className='system-sm-semibold text-text-secondary flex items-center justify-between py-2'>
            <div className='flex items-center space-x-2'>
              <span className={cn(fieldLabelClassName, 'system-sm-regular text-text-secondary flex items-center py-2')}>{label[language] || label.en_US}</span>
              {required && (
                <span className='ml-1 text-red-500'>*</span>
              )}
              {tooltipContent}
            </div>
            <Radio.Group
              className='flex items-center'
              value={value[variable] === null ? undefined : (value[variable] ? 1 : 0)}
              onChange={val => handleFormChange(variable, val === 1)}
            >
              <Radio value={1} className='!mr-1'>True</Radio>
              <Radio value={0}>False</Radio>
            </Radio.Group>
          </div>
          {fieldMoreInfo?.(formSchema)}
        </div>
      )
    }

    if (formSchema.type === FormTypeEnum.modelSelector) {
      const {
        variable, label, required, scope,
      } = formSchema as (CredentialFormSchemaTextInput | CredentialFormSchemaSecretInput)
      return (
        <div key={variable} className={cn(itemClassName, 'py-3')}>
          <div className={cn(fieldLabelClassName, 'system-sm-semibold text-text-secondary flex items-center py-2')}>
            {label[language] || label.en_US}
            {required && (
              <span className='ml-1 text-red-500'>*</span>
            )}
            {tooltipContent}
          </div>
          <ModelParameterModal
            popupClassName='!w-[387px]'
            isAdvancedMode
            isInWorkflow
            isAgentStrategy={isAgentStrategy}
            value={value[variable]}
            setModel={model => handleModelChanged(variable, model)}
            readonly={readonly}
            scope={scope} />
          {fieldMoreInfo?.(formSchema)}
          {validating && changeKey === variable && <ValidatingTip />}
        </div>
      )
    }

    if (formSchema.type === FormTypeEnum.toolSelector) {
      const {
        variable,
        label,
        required,
        scope,
      } = formSchema as (CredentialFormSchemaTextInput | CredentialFormSchemaSecretInput)
      return (
        <div key={variable} className={cn(itemClassName, 'py-3')}>
          <div className={cn(fieldLabelClassName, 'system-sm-semibold text-text-secondary flex items-center py-2')}>
            {label[language] || label.en_US}
            {required && (
              <span className='ml-1 text-red-500'>*</span>
            )}
            {tooltipContent}
          </div>
          <ToolSelector
            scope={scope}
            nodeId={nodeId}
            nodeOutputVars={nodeOutputVars || []}
            availableNodes={availableNodes || []}
            disabled={readonly}
            value={value[variable]}
            // selectedTools={value[variable] ? [value[variable]] : []}
            onSelect={item => handleFormChange(variable, item as any)}
            onDelete={() => handleFormChange(variable, null as any)}
          />
          {fieldMoreInfo?.(formSchema)}
          {validating && changeKey === variable && <ValidatingTip />}
        </div>
      )
    }

    if (formSchema.type === FormTypeEnum.multiToolSelector) {
      const {
        variable,
        label,
        tooltip,
        required,
        scope,
      } = formSchema as (CredentialFormSchemaTextInput | CredentialFormSchemaSecretInput)

      return (
        <div key={variable} className={cn(itemClassName, 'py-3')}>
          <MultipleToolSelector
            disabled={readonly}
            nodeId={nodeId}
            nodeOutputVars={nodeOutputVars || []}
            availableNodes={availableNodes || []}
            scope={scope}
            label={label[language] || label.en_US}
            required={required}
            tooltip={tooltip?.[language] || tooltip?.en_US}
            value={value[variable] || []}
            onChange={item => handleFormChange(variable, item as any)}
          />
          {fieldMoreInfo?.(formSchema)}
          {validating && changeKey === variable && <ValidatingTip />}
        </div>
      )
    }

    if (formSchema.type === FormTypeEnum.appSelector) {
      const {
        variable, label, required, scope,
      } = formSchema as (CredentialFormSchemaTextInput | CredentialFormSchemaSecretInput)

      return (
        <div key={variable} className={cn(itemClassName, 'py-3')}>
          <div className={cn(fieldLabelClassName, 'system-sm-semibold text-text-secondary flex items-center py-2')}>
            {label[language] || label.en_US}
            {required && (
              <span className='ml-1 text-red-500'>*</span>
            )}
            {tooltipContent}
          </div>
          <AppSelector
            disabled={readonly}
            scope={scope}
            value={value[variable]}
            onSelect={item => handleFormChange(variable, { ...item, type: FormTypeEnum.appSelector } as any)} />
          {fieldMoreInfo?.(formSchema)}
          {validating && changeKey === variable && <ValidatingTip />}
        </div>
      )
    }

    // @ts-expect-error it work
    if (!Object.values(FormTypeEnum).includes(formSchema.type))
      return customRenderField?.(formSchema as CustomFormSchema, filteredProps)
  }

  return (
    <div className={className}>
      {formSchemas.map(formSchema => renderField(formSchema))}
    </div>
  )
}

export default Form
