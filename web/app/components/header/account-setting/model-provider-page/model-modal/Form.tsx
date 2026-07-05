import type { ReactNode } from 'react'
import type { Node } from 'reactflow'
import type {
  CredentialFormSchema,
  CredentialFormSchemaNumberInput,
  CredentialFormSchemaRadio,
  CredentialFormSchemaSecretInput,
  CredentialFormSchemaSelect,
  CredentialFormSchemaTextInput,
  FormValue,
} from '../declarations'
import type {
  NodeOutPutVar,
} from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { FieldItem, FieldLabel, FieldRoot } from '@langgenius/dify-ui/field'
import { FieldsetLegend, FieldsetRoot } from '@langgenius/dify-ui/fieldset'
import { Radio } from '@langgenius/dify-ui/radio'
import { RadioGroup } from '@langgenius/dify-ui/radio-group'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectLabel, SelectTrigger } from '@langgenius/dify-ui/select'
import { useCallback, useState } from 'react'
import { Infotip } from '@/app/components/base/infotip'
import { AppSelector } from '@/app/components/plugins/plugin-detail-panel/app-selector'
import ModelParameterModal from '@/app/components/plugins/plugin-detail-panel/model-selector'
import MultipleToolSelector from '@/app/components/plugins/plugin-detail-panel/multiple-tool-selector'
import ToolSelector from '@/app/components/plugins/plugin-detail-panel/tool-selector'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import { ValidatingTip } from '../../key-validator/ValidateStatus'
import { FormTypeEnum } from '../declarations'
import { useLanguage } from '../hooks'
import Input from './Input'

const radioGridColumnsClassNames: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
  6: 'grid-cols-6',
  7: 'grid-cols-7',
  8: 'grid-cols-8',
  9: 'grid-cols-9',
  10: 'grid-cols-10',
  11: 'grid-cols-11',
  12: 'grid-cols-12',
}

type ModelSelectorValue = Record<string, unknown>

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
    props: Omit<FormProps<CustomFormSchema>, 'override' | 'customRenderField'>,
  ) => ReactNode
  // If return falsy value, this field will fallback to default render
  override?: [Array<FormTypeEnum>, (formSchema: CredentialFormSchema, props: Omit<FormProps<CustomFormSchema>, 'override' | 'customRenderField'>) => ReactNode]
  nodeId?: string
  nodeOutputVars?: NodeOutPutVar[]
  availableNodes?: Node[]
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

  const handleFormChange = (key: string, val: FormValue[string]) => {
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

  const handleModelChanged = useCallback((key: string, model: ModelSelectorValue) => {
    const newValue = {
      ...value[key],
      ...model,
      type: FormTypeEnum.modelSelector,
    }
    onChange({ ...value, [key]: newValue })
  }, [onChange, value])

  const renderField = (formSchema: CredentialFormSchema | CustomFormSchema) => {
    const infotip = formSchema.tooltip
    const infotipText = infotip?.[language] || infotip?.en_US
    const infotipContent = (infotipText && (
      <Infotip
        aria-label={infotipText}
        className="ml-1"
        popupClassName="w-[200px] max-w-[200px]"
      >
        {infotipText}
      </Infotip>
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
        variable,
        label,
        placeholder,
        required,
        show_on,
      } = formSchema as (CredentialFormSchemaTextInput | CredentialFormSchemaSecretInput)

      if (show_on.length && !show_on.every(showOnItem => value[showOnItem.variable] === showOnItem.value))
        return null

      const disabled = readonly || (isEditMode && (variable === '__model_type' || variable === '__model_name'))
      return (
        <div key={variable} className={cn(itemClassName, 'py-3')}>
          <div className={cn(fieldLabelClassName, 'flex items-center py-2 system-sm-semibold text-text-secondary')}>
            {label[language] || label.en_US}
            {required && (
              <span className="ml-1 text-red-500">*</span>
            )}
            {infotipContent}
          </div>
          <Input
            className={cn(inputClassName, `${disabled && 'cursor-not-allowed opacity-60'}`)}
            value={(isShowDefaultValue && ((value[variable] as string) === '' || value[variable] === undefined || value[variable] === null)) ? formSchema.default : value[variable]}
            onChange={val => handleFormChange(variable, val)}
            validated={validatedSuccess}
            placeholder={placeholder?.[language] || placeholder?.en_US}
            disabled={disabled}
            type={formSchema.type === FormTypeEnum.secretInput
              ? 'password'
              : formSchema.type === FormTypeEnum.textNumber
                ? 'number'
                : 'text'}
            {...(formSchema.type === FormTypeEnum.textNumber ? { min: (formSchema as CredentialFormSchemaNumberInput).min, max: (formSchema as CredentialFormSchemaNumberInput).max } : {})}
          />
          {fieldMoreInfo?.(formSchema)}
          {validating && changeKey === variable && <ValidatingTip />}
        </div>
      )
    }

    if (formSchema.type === FormTypeEnum.radio) {
      const {
        options,
        variable,
        label,
        show_on,
        required,
      } = formSchema as CredentialFormSchemaRadio

      if (show_on.length && !show_on.every(showOnItem => value[showOnItem.variable] === showOnItem.value))
        return null

      const disabled = isEditMode && (variable === '__model_type' || variable === '__model_name')
      const gridColumnsClassName = radioGridColumnsClassNames[options.length] ?? 'grid-cols-1'
      const selectedValue = typeof value[variable] === 'string' ? value[variable] : undefined
      const translatedLabel = label[language] || label.en_US

      return (
        <FieldRoot key={variable} name={variable} className="contents">
          <FieldsetRoot
            render={(
              <RadioGroup
                value={selectedValue}
                onValueChange={val => handleFormChange(variable, val)}
                className={cn(itemClassName, 'grid gap-3 py-3', gridColumnsClassName)}
              />
            )}
          >
            <FieldsetLegend className={cn(fieldLabelClassName, 'col-span-full flex items-center py-2 system-sm-semibold text-text-secondary')}>
              <span>{translatedLabel}</span>
              {required && (
                <span className="ml-1 text-red-500">*</span>
              )}
              {infotipContent}
            </FieldsetLegend>
            {options.filter((option) => {
              if (option.show_on.length)
                return option.show_on.every(showOnItem => value[showOnItem.variable] === showOnItem.value)

              return true
            }).map(option => (
              <FieldItem key={`${variable}-${option.value}`} className="min-w-0">
                <FieldLabel
                  className={`
                    flex cursor-pointer items-center gap-2 rounded-lg border border-components-option-card-option-border bg-components-option-card-option-bg px-3 py-2
                    ${value[variable] === option.value && 'border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg shadow-sm'}
                    ${disabled && 'cursor-not-allowed! opacity-60'}
                  `}
                >
                  <Radio value={option.value} disabled={disabled} />

                  <div className="system-sm-regular text-text-secondary">{option.label[language] || option.label.en_US}</div>
                </FieldLabel>
              </FieldItem>
            ))}
            <div className="col-span-full">
              {fieldMoreInfo?.(formSchema)}
              {validating && changeKey === variable && <ValidatingTip />}
            </div>
          </FieldsetRoot>
        </FieldRoot>
      )
    }

    if (formSchema.type === FormTypeEnum.select) {
      const {
        options,
        variable,
        label,
        show_on,
        required,
        placeholder,
      } = formSchema as CredentialFormSchemaSelect

      if (show_on.length && !show_on.every(showOnItem => value[showOnItem.variable] === showOnItem.value))
        return null

      const filteredOptions = options.filter((option) => {
        if (option.show_on.length)
          return option.show_on.every(showOnItem => value[showOnItem.variable] === showOnItem.value)

        return true
      }).map(option => ({ value: option.value, name: option.label[language] || option.label.en_US }))
      const currentValue = (isShowDefaultValue && ((value[variable] as string) === '' || value[variable] === undefined || value[variable] === null))
        ? formSchema.default
        : value[variable]
      const selectedOption = filteredOptions.find(option => option.value === currentValue)
      const translatedLabel = label[language] || label.en_US

      return (
        <div key={variable} className={cn(itemClassName, 'py-3')}>
          <div className={cn(fieldLabelClassName, 'flex items-center py-2 system-sm-semibold text-text-secondary')}>
            {translatedLabel}

            {required && (
              <span className="ml-1 text-red-500">*</span>
            )}
            {infotipContent}
          </div>
          <Select
            disabled={readonly}
            value={selectedOption?.value ?? null}
            onValueChange={(nextValue) => {
              if (!nextValue)
                return
              handleFormChange(variable, nextValue)
            }}
          >
            <SelectLabel className="sr-only">{translatedLabel}</SelectLabel>
            <SelectTrigger size="medium" className={cn(inputClassName)}>
              {selectedOption?.name ?? placeholder?.[language] ?? placeholder?.en_US}
            </SelectTrigger>
            <SelectContent>
              {filteredOptions.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  <SelectItemText>{option.name}</SelectItemText>
                  <SelectItemIndicator />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldMoreInfo?.(formSchema)}
          {validating && changeKey === variable && <ValidatingTip />}
        </div>
      )
    }

    if (formSchema.type === FormTypeEnum.checkbox) {
      const {
        variable,
        label,
        show_on,
        required,
      } = formSchema as CredentialFormSchemaRadio

      if (show_on.length && !show_on.every(showOnItem => value[showOnItem.variable] === showOnItem.value))
        return null
      const booleanValue = typeof value[variable] === 'boolean' ? value[variable] : undefined
      const translatedLabel = label[language] || label.en_US

      return (
        <div key={variable} className={cn(itemClassName, 'py-3')}>
          <FieldRoot name={variable} className="contents">
            <FieldsetRoot
              render={(
                <RadioGroup<boolean>
                  className="flex items-center justify-between gap-3 py-2"
                  value={booleanValue}
                  onValueChange={val => handleFormChange(variable, val)}
                />
              )}
            >
              <FieldsetLegend className={cn(fieldLabelClassName, 'flex items-center py-2 system-sm-semibold text-text-secondary')}>
                <span>{translatedLabel}</span>
                {required && (
                  <span className="ml-1 text-red-500">*</span>
                )}
                {infotipContent}
              </FieldsetLegend>
              <div className="flex items-center gap-3">
                <FieldItem>
                  <FieldLabel className="flex items-center gap-1.5 system-sm-regular text-text-secondary">
                    <Radio<boolean> value={true} />
                    True
                  </FieldLabel>
                </FieldItem>
                <FieldItem>
                  <FieldLabel className="flex items-center gap-1.5 system-sm-regular text-text-secondary">
                    <Radio<boolean> value={false} />
                    False
                  </FieldLabel>
                </FieldItem>
              </div>
            </FieldsetRoot>
          </FieldRoot>
          {fieldMoreInfo?.(formSchema)}
        </div>
      )
    }

    if (formSchema.type === FormTypeEnum.modelSelector) {
      const {
        variable,
        label,
        required,
        scope,
      } = formSchema as (CredentialFormSchemaTextInput | CredentialFormSchemaSecretInput)
      return (
        <div key={variable} className={cn(itemClassName, 'py-3')}>
          <div className={cn(fieldLabelClassName, 'flex items-center py-2 system-sm-semibold text-text-secondary')}>
            {label[language] || label.en_US}
            {required && (
              <span className="ml-1 text-red-500">*</span>
            )}
            {infotipContent}
          </div>
          <ModelParameterModal
            popupClassName="w-[387px]!"
            isAdvancedMode
            isInWorkflow
            isAgentStrategy={isAgentStrategy}
            value={value[variable]}
            setModel={model => handleModelChanged(variable, model)}
            readonly={readonly}
            scope={scope}
          />
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
          <div className={cn(fieldLabelClassName, 'flex items-center py-2 system-sm-semibold text-text-secondary')}>
            {label[language] || label.en_US}
            {required && (
              <span className="ml-1 text-red-500">*</span>
            )}
            {infotipContent}
          </div>
          <ToolSelector
            scope={scope}
            nodeId={nodeId}
            nodeOutputVars={nodeOutputVars || []}
            availableNodes={availableNodes || []}
            disabled={readonly}
            value={value[variable]}
            // selectedTools={value[variable] ? [value[variable]] : []}
            onSelect={item => handleFormChange(variable, item)}
            onDelete={() => handleFormChange(variable, null)}
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
        tooltip: infotip,
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
            tooltip={infotip?.[language] || infotip?.en_US}
            value={value[variable] || []}
            onChange={item => handleFormChange(variable, item)}
            supportCollapse
          />
          {fieldMoreInfo?.(formSchema)}
          {validating && changeKey === variable && <ValidatingTip />}
        </div>
      )
    }

    if (formSchema.type === FormTypeEnum.appSelector) {
      const {
        variable,
        label,
        required,
        scope,
      } = formSchema as (CredentialFormSchemaTextInput | CredentialFormSchemaSecretInput)

      return (
        <div key={variable} className={cn(itemClassName, 'py-3')}>
          <div className={cn(fieldLabelClassName, 'flex items-center py-2 system-sm-semibold text-text-secondary')}>
            {label[language] || label.en_US}
            {required && (
              <span className="ml-1 text-red-500">*</span>
            )}
            {infotipContent}
          </div>
          <AppSelector
            disabled={readonly}
            scope={scope}
            value={value[variable]}
            onSelect={item => handleFormChange(variable, { ...item, type: FormTypeEnum.appSelector })}
          />
          {fieldMoreInfo?.(formSchema)}
          {validating && changeKey === variable && <ValidatingTip />}
        </div>
      )
    }

    if (formSchema.type === FormTypeEnum.any) {
      const {
        variable,
        label,
        required,
        scope,
      } = formSchema as (CredentialFormSchemaTextInput | CredentialFormSchemaSecretInput)

      return (
        <div key={variable} className={cn(itemClassName, 'py-3')}>
          <div className={cn(fieldLabelClassName, 'flex items-center py-2 system-sm-semibold text-text-secondary')}>
            {label[language] || label.en_US}
            {required && (
              <span className="ml-1 text-red-500">*</span>
            )}
            {infotipContent}
          </div>
          <VarReferencePicker
            readonly={false}
            isShowNodeName
            nodeId={nodeId || ''}
            value={value[variable] || []}
            onChange={item => handleFormChange(variable, item)}
            filterVar={(varPayload) => {
              if (!scope)
                return true
              return scope.split('&').includes(varPayload.type)
            }}
          />
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
