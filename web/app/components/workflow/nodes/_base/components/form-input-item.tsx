'use client'
import type { FC } from 'react'
import type { ResourceVarInputs } from '../types'
import type { CredentialFormSchema, FormOption, FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Event, Tool } from '@/app/components/tools/types'
import type { TriggerWithProvider } from '@/app/components/workflow/block-selector/types'
import type { ToolWithProvider, ValueSelector, Var } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import { useEffect, useMemo, useState } from 'react'
import CheckboxList from '@/app/components/base/checkbox-list'
import Input from '@/app/components/base/input'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import AppSelector from '@/app/components/plugins/plugin-detail-panel/app-selector'
import ModelParameterModal from '@/app/components/plugins/plugin-detail-panel/model-selector'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import MixedVariableTextInput from '@/app/components/workflow/nodes/tool/components/mixed-variable-text-input'
import { VarType } from '@/app/components/workflow/types'
import { useFetchDynamicOptions } from '@/service/use-plugins'
import { useTriggerPluginDynamicOptions } from '@/service/use-triggers'
import { VarKindType } from '../types'
import FormInputBoolean from './form-input-boolean'
import {
  filterVisibleOptions,
  getCheckboxListOptions,
  getCheckboxListValue,
  getFilterVar,
  getFormInputState,
  getNumberInputValue,
  getSelectedLabels,
  getTargetVarType,
  getVarKindType,
  mapSelectItems,
  normalizeVariableSelectorValue,
} from './form-input-item.helpers'
import {
  JsonEditorField,
  MultiSelectField,
} from './form-input-item.sections'
import FormInputTypeSwitch from './form-input-type-switch'

type Props = {
  readOnly: boolean
  nodeId: string
  schema: CredentialFormSchema
  value: ResourceVarInputs
  onChange: (value: ResourceVarInputs) => void
  inPanel?: boolean
  currentTool?: Tool | Event
  currentProvider?: ToolWithProvider | TriggerWithProvider
  showManageInputField?: boolean
  onManageInputField?: () => void
  extraParams?: Record<string, unknown>
  providerType?: string
  disableVariableInsertion?: boolean
}

type FormInputValue = string | number | boolean | string[] | Record<string, unknown> | null | undefined

const FormInputItem: FC<Props> = ({
  readOnly,
  nodeId,
  schema,
  value,
  onChange,
  currentTool,
  currentProvider,
  showManageInputField,
  onManageInputField,
  extraParams,
  providerType,
  disableVariableInsertion = false,
}) => {
  const language = useLanguage()
  const [toolsOptions, setToolsOptions] = useState<FormOption[] | null>(null)
  const [isLoadingToolsOptions, setIsLoadingToolsOptions] = useState(false)

  const formState = getFormInputState(schema as CredentialFormSchema & {
    _type?: FormTypeEnum
    multiple?: boolean
    options?: FormOption[]
    scope?: string
  }, value[schema.variable])

  const {
    defaultValue,
    isAppSelector,
    isBoolean,
    isCheckbox,
    isConstant,
    isDynamicSelect,
    isModelSelector,
    isMultipleSelect,
    isNumber,
    isSelect,
    isShowJSONEditor,
    isString,
    options,
    placeholder,
    scope,
    showTypeSwitch,
    showVariableSelector,
    variable,
  } = formState
  const varInput = value[variable]

  const { availableVars, availableNodesWithParent } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar: false,
    filterVar: (varPayload: Var) => {
      return [VarType.string, VarType.number, VarType.secret].includes(varPayload.type)
    },
  })

  // Fetch dynamic options hook for tools
  const { mutateAsync: fetchDynamicOptions } = useFetchDynamicOptions(
    currentProvider?.plugin_id || '',
    currentProvider?.name || '',
    currentTool?.name || '',
    variable || '',
    providerType,
    extraParams,
  )

  // Fetch dynamic options hook for triggers
  const { data: triggerDynamicOptions, isLoading: isTriggerOptionsLoading } = useTriggerPluginDynamicOptions({
    plugin_id: currentProvider?.plugin_id || '',
    provider: currentProvider?.name || '',
    action: currentTool?.name || '',
    parameter: variable || '',
    extra: extraParams,
    credential_id: currentProvider?.credential_id || '',
  }, isDynamicSelect && providerType === PluginCategoryEnum.trigger && !!currentTool && !!currentProvider)

  // Computed values for dynamic options (unified for triggers and tools)
  const triggerOptions = triggerDynamicOptions?.options
  const dynamicOptions = providerType === PluginCategoryEnum.trigger
    ? triggerOptions ?? toolsOptions
    : toolsOptions
  const isLoadingOptions = providerType === PluginCategoryEnum.trigger
    ? (isTriggerOptionsLoading || isLoadingToolsOptions)
    : isLoadingToolsOptions

  // Fetch dynamic options for tools only (triggers use hook directly)
  useEffect(() => {
    const fetchPanelDynamicOptions = async () => {
      if (isDynamicSelect && currentTool && currentProvider && (providerType === PluginCategoryEnum.tool || providerType === PluginCategoryEnum.trigger)) {
        setIsLoadingToolsOptions(true)
        try {
          const data = await fetchDynamicOptions()
          setToolsOptions(data?.options || [])
        }
        catch (error) {
          console.error('Failed to fetch dynamic options:', error)
          setToolsOptions([])
        }
        finally {
          setIsLoadingToolsOptions(false)
        }
      }
    }

    fetchPanelDynamicOptions()
  }, [
    isDynamicSelect,
    currentTool?.name,
    currentProvider?.name,
    variable,
    extraParams,
    providerType,
    fetchDynamicOptions,
  ])

  const handleTypeChange = (newType: string) => {
    if (newType === VarKindType.variable) {
      onChange({
        ...value,
        [variable]: {
          ...varInput,
          type: VarKindType.variable,
          value: '',
        },
      })
    }
    else {
      onChange({
        ...value,
        [variable]: {
          ...varInput,
          type: VarKindType.constant,
          value: defaultValue,
        },
      })
    }
  }

  const handleValueChange = (newValue: FormInputValue) => {
    const nextType = getVarKindType(formState) ?? varInput?.type ?? VarKindType.constant
    onChange({
      ...value,
      [variable]: {
        ...varInput,
        type: nextType,
        value: isNumber ? Number.parseFloat(String(newValue ?? '')) : newValue,
      },
    })
  }

  const handleAppOrModelSelect = (newValue: Record<string, unknown>) => {
    const nextType = getVarKindType(formState) ?? varInput?.type ?? VarKindType.constant
    onChange({
      ...value,
      [variable]: {
        ...varInput,
        type: nextType,
        value: newValue,
      },
    })
  }

  const handleVariableSelectorChange = (newValue: ValueSelector | string, variable: string) => {
    onChange({
      ...value,
      [variable]: {
        ...varInput,
        type: VarKindType.variable,
        value: normalizeVariableSelectorValue(newValue),
      },
    })
  }

  const availableCheckboxOptions = useMemo(
    () => filterVisibleOptions(options, value),
    [options, value],
  )
  const checkboxListOptions = useMemo(
    () => getCheckboxListOptions(availableCheckboxOptions, language),
    [availableCheckboxOptions, language],
  )
  const checkboxListValue = useMemo(
    () => getCheckboxListValue(varInput?.value, defaultValue, availableCheckboxOptions),
    [availableCheckboxOptions, defaultValue, varInput?.value],
  )

  const visibleSelectOptions = useMemo(
    () => filterVisibleOptions(options, value),
    [options, value],
  )
  const visibleDynamicOptions = useMemo(
    () => filterVisibleOptions(dynamicOptions || options || [], value),
    [dynamicOptions, options, value],
  )
  const staticSelectItems = useMemo(
    () => mapSelectItems(visibleSelectOptions, language),
    [language, visibleSelectOptions],
  )
  const dynamicSelectItems = useMemo(
    () => mapSelectItems(visibleDynamicOptions, language),
    [language, visibleDynamicOptions],
  )
  const selectedLabels = useMemo(
    () => getSelectedLabels(varInput?.value as string[] | undefined, isDynamicSelect ? visibleDynamicOptions : visibleSelectOptions, language),
    [isDynamicSelect, language, varInput?.value, visibleDynamicOptions, visibleSelectOptions],
  )

  const handleCheckboxListChange = (selected: string[]) => {
    onChange({
      ...value,
      [variable]: {
        ...varInput,
        type: VarKindType.constant,
        value: selected,
      },
    })
  }
  const selectedStaticOption = staticSelectItems.find(item => item.value === (varInput?.value as string | undefined)) ?? null
  const selectedDynamicOption = dynamicSelectItems.find(item => item.value === (varInput?.value as string | undefined)) ?? null

  return (
    <div className={cn('gap-1', !(isShowJSONEditor && isConstant) && 'flex')}>
      {showTypeSwitch && (
        <FormInputTypeSwitch value={varInput?.type || VarKindType.constant} onChange={handleTypeChange} />
      )}
      {isString && (
        <MixedVariableTextInput
          readOnly={readOnly}
          value={varInput?.value as string || ''}
          onChange={handleValueChange}
          nodesOutputVars={availableVars}
          availableNodes={availableNodesWithParent}
          showManageInputField={showManageInputField}
          onManageInputField={onManageInputField}
          disableVariableInsertion={disableVariableInsertion}
        />
      )}
      {isNumber && isConstant && (
        <Input
          className="h-8 grow"
          type="number"
          value={getNumberInputValue(varInput?.value)}
          onChange={e => handleValueChange(e.target.value)}
          placeholder={placeholder?.[language] || placeholder?.en_US}
        />
      )}
      {isCheckbox && isConstant && (
        <CheckboxList
          title={schema.label?.[language] || schema.label?.en_US || variable}
          value={checkboxListValue}
          onChange={handleCheckboxListChange}
          options={checkboxListOptions}
          disabled={readOnly}
          maxHeight="200px"
        />
      )}
      {isBoolean && isConstant && (
        <FormInputBoolean
          value={varInput?.value as boolean}
          onChange={handleValueChange}
        />
      )}
      {isSelect && isConstant && !isMultipleSelect && (
        <Select
          value={selectedStaticOption?.value ?? null}
          disabled={readOnly}
          onValueChange={value => value && handleValueChange(value)}
        >
          <SelectTrigger className="h-8 grow">
            {selectedStaticOption?.name ?? placeholder?.[language] ?? placeholder?.en_US}
          </SelectTrigger>
          <SelectContent>
            {staticSelectItems.map(item => (
              <SelectItem key={item.value} value={item.value}>
                {item.icon && (
                  <img src={item.icon} alt="" className="mr-2 h-4 w-4 shrink-0" />
                )}
                <SelectItemText>{item.name}</SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {isSelect && isConstant && isMultipleSelect && (
        <MultiSelectField
          disabled={readOnly}
          value={(varInput?.value as string[] | undefined) || []}
          items={staticSelectItems}
          onChange={handleValueChange}
          placeholder={placeholder?.[language] || placeholder?.en_US}
          selectedLabel={selectedLabels}
        />
      )}
      {isDynamicSelect && !isMultipleSelect && (
        <Select
          value={selectedDynamicOption?.value ?? null}
          disabled={readOnly || isLoadingOptions}
          onValueChange={value => value && handleValueChange(value)}
        >
          <SelectTrigger className="h-8 grow">
            {selectedDynamicOption?.name ?? (isLoadingOptions ? 'Loading...' : (placeholder?.[language] ?? placeholder?.en_US))}
          </SelectTrigger>
          <SelectContent>
            {dynamicSelectItems.map(item => (
              <SelectItem key={item.value} value={item.value}>
                {item.icon && (
                  <img src={item.icon} alt="" className="mr-2 h-4 w-4 shrink-0" />
                )}
                <SelectItemText>{item.name}</SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {isDynamicSelect && isMultipleSelect && (
        <MultiSelectField
          disabled={readOnly || isLoadingOptions}
          isLoading={isLoadingOptions}
          value={(varInput?.value as string[] | undefined) || []}
          items={dynamicSelectItems}
          onChange={handleValueChange}
          placeholder={placeholder?.[language] || placeholder?.en_US}
          selectedLabel={selectedLabels}
        />
      )}
      {isShowJSONEditor && isConstant && (
        <JsonEditorField
          value={(varInput?.value as string) || ''}
          onChange={handleValueChange}
          placeholder={<div className="whitespace-pre">{placeholder?.[language] || placeholder?.en_US}</div>}
        />
      )}
      {isAppSelector && (
        <AppSelector
          disabled={readOnly}
          scope={scope || 'all'}
          value={varInput?.value}
          onSelect={handleAppOrModelSelect}
        />
      )}
      {isModelSelector && isConstant && (
        <ModelParameterModal
          popupClassName="w-[387px]!"
          isAdvancedMode
          isInWorkflow
          value={varInput?.value}
          setModel={handleAppOrModelSelect}
          readonly={readOnly}
          scope={scope}
        />
      )}
      {showVariableSelector && (
        <VarReferencePicker
          className="h-8 grow"
          readonly={readOnly}
          isShowNodeName
          nodeId={nodeId}
          value={varInput?.value || []}
          onChange={value => handleVariableSelectorChange(value, variable)}
          filterVar={getFilterVar(formState)}
          schema={schema}
          valueTypePlaceHolder={getTargetVarType(formState)}
          currentTool={currentTool}
          currentProvider={currentProvider}
          isFilterFileVar={isBoolean}
        />
      )}
    </div>
  )
}
export default FormInputItem
