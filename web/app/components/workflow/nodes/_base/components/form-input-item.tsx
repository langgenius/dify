'use client'
import type { FC } from 'react'
import type { NestedNodeConfig, ResourceVarInputs } from '../types'
import type { CredentialFormSchema, FormOption, FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Event, Tool } from '@/app/components/tools/types'
import type { TriggerWithProvider } from '@/app/components/workflow/block-selector/types'
import type { ToolWithProvider, ValueSelector, Var } from '@/app/components/workflow/types'
import { useContext, useEffect, useMemo, useState } from 'react'
import CheckboxList from '@/app/components/base/checkbox-list'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import Input from '@/app/components/base/input'
import { SimpleSelect } from '@/app/components/base/select'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import AppSelector from '@/app/components/plugins/plugin-detail-panel/app-selector'
import ModelParameterModal from '@/app/components/plugins/plugin-detail-panel/model-selector'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { WorkflowContext } from '@/app/components/workflow/context'
import { HooksStoreContext } from '@/app/components/workflow/hooks-store/provider'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import { NULL_STRATEGY } from '@/app/components/workflow/nodes/_base/constants'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import MixedVariableTextInput from '@/app/components/workflow/nodes/tool/components/mixed-variable-text-input'
import { useFetchDynamicOptions } from '@/service/use-plugins'
import { useTriggerPluginDynamicOptions } from '@/service/use-triggers'
import { cn } from '@/utils/classnames'
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
  hasOptionIcon,
  mapSelectItems,
  normalizeVariableSelectorValue,
} from './form-input-item.helpers'
import {
  JsonEditorField,
  MultiSelectField,
} from './form-input-item.sections'
import FormInputTypeSwitch from './form-input-type-switch'

type VariableReferenceFieldsProps = {
  canRenderVariableReference: boolean
  currentProvider?: ToolWithProvider | TriggerWithProvider
  currentTool?: Tool | Event
  disableVariableInsertion?: boolean
  filterVar?: (payload: Var, selector: ValueSelector) => boolean
  inPanel?: boolean
  isBoolean: boolean
  isString: boolean
  nodeId: string
  onManageInputField?: () => void
  onValueChange: (newValue: unknown, newType?: VarKindType, nestedNodeConfig?: NestedNodeConfig | null) => void
  onVariableSelectorChange: (newValue: ValueSelector | string, variable: string) => void
  readOnly: boolean
  schema: CredentialFormSchema
  showManageInputField?: boolean
  showVariableSelector: boolean
  targetVarType: string
  value: ResourceVarInputs[string]
  variable: string
}

const VariableReferenceFields: FC<VariableReferenceFieldsProps> = ({
  canRenderVariableReference,
  currentProvider,
  currentTool,
  disableVariableInsertion,
  filterVar,
  inPanel,
  isBoolean,
  isString,
  nodeId,
  onManageInputField,
  onValueChange,
  onVariableSelectorChange,
  readOnly,
  schema,
  showManageInputField,
  showVariableSelector,
  targetVarType,
  value,
  variable,
}) => {
  const { availableVars, availableNodesWithParent } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar: false,
    filterVar: filterVar || (() => true),
  })

  if (!canRenderVariableReference)
    return null

  return (
    <>
      {isString && (
        <MixedVariableTextInput
          readOnly={readOnly}
          value={value?.value as string || ''}
          onChange={onValueChange}
          nodesOutputVars={availableVars}
          availableNodes={availableNodesWithParent}
          showManageInputField={showManageInputField}
          onManageInputField={onManageInputField}
          disableVariableInsertion={disableVariableInsertion}
          toolNodeId={nodeId}
          paramKey={variable}
        />
      )}
      {showVariableSelector && (
        <VarReferencePicker
          zIndex={inPanel ? 1000 : undefined}
          className="h-8 grow"
          readonly={readOnly}
          isShowNodeName
          nodeId={nodeId}
          value={value?.value || []}
          onChange={newValue => onVariableSelectorChange(newValue, variable)}
          filterVar={filterVar}
          schema={schema}
          valueTypePlaceHolder={targetVarType}
          currentTool={currentTool}
          currentProvider={currentProvider}
          isFilterFileVar={isBoolean}
          availableVars={availableVars}
          availableNodes={availableNodesWithParent}
        />
      )}
    </>
  )
}

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

const FormInputItem: FC<Props> = ({
  readOnly,
  nodeId,
  schema,
  value,
  onChange,
  inPanel,
  currentTool,
  currentProvider,
  showManageInputField,
  onManageInputField,
  extraParams,
  providerType,
  disableVariableInsertion = false,
}) => {
  const language = useLanguage()
  const featuresStore = useFeaturesStore()
  const hooksStore = useContext(HooksStoreContext)
  const workflowStore = useContext(WorkflowContext)
  const canUseWorkflowHooks = !!hooksStore && !!workflowStore
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
    variable,
  } = formState
  const varInput = value[variable]
  const showTypeSwitch = canUseWorkflowHooks && formState.showTypeSwitch
  const showVariableSelector = canUseWorkflowHooks && formState.showVariableSelector
  const canRenderVariableReference = canUseWorkflowHooks && !!nodeId
  const canMountVariableReferenceFields = canRenderVariableReference && !!featuresStore
  const jsonEditorValue = useMemo(() => {
    const currentValue = varInput?.value
    if (currentValue === undefined || currentValue === null)
      return ''
    if (typeof currentValue === 'string')
      return currentValue
    if (typeof currentValue === 'object')
      return JSON.stringify(currentValue, null, 2)
    return ''
  }, [varInput?.value])

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
    currentTool,
    currentProvider,
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

  const handleValueChange = (newValue: unknown, newType?: VarKindType, nestedNodeConfig?: NestedNodeConfig | null) => {
    const normalizedValue = isNumber ? Number.parseFloat(String(newValue)) : newValue
    const assemblePlaceholder = nodeId && variable
      ? `{{#${nodeId}_ext_${variable}.result#}}`
      : ''
    const isAssembleValue = typeof normalizedValue === 'string'
      && !!assemblePlaceholder
      && normalizedValue.includes(assemblePlaceholder)
    const resolvedType = isAssembleValue
      ? VarKindType.nested_node
      : newType ?? (varInput?.type === VarKindType.nested_node ? VarKindType.nested_node : getVarKindType(formState))
    const nextVarKindType = resolvedType ?? varInput?.type ?? VarKindType.constant
    const resolvedNestedNodeConfig = resolvedType === VarKindType.nested_node
      ? (nestedNodeConfig ?? varInput?.nested_node_config ?? {
          extractor_node_id: nodeId && variable ? `${nodeId}_ext_${variable}` : '',
          output_selector: ['result'],
          null_strategy: NULL_STRATEGY.RAISE_ERROR,
          default_value: '',
        })
      : undefined

    onChange({
      ...value,
      [variable]: {
        ...varInput,
        type: nextVarKindType,
        value: normalizedValue,
        nested_node_config: resolvedNestedNodeConfig,
      },
    })
  }

  const handleAppOrModelSelect = (newValue: unknown) => {
    onChange({
      ...value,
      [variable]: {
        ...varInput,
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

  return (
    <div className={cn('gap-1', !(isShowJSONEditor && isConstant) && 'flex')}>
      {showTypeSwitch && (
        <FormInputTypeSwitch value={varInput?.type || VarKindType.constant} onChange={handleTypeChange} />
      )}
      {isString && !canRenderVariableReference && (
        <Input
          className="h-8 grow"
          value={varInput?.value as string || ''}
          onChange={e => handleValueChange(e.target.value)}
          placeholder={placeholder?.[language] || placeholder?.en_US}
          disabled={readOnly}
        />
      )}
      {canMountVariableReferenceFields && (isString || showVariableSelector) && (
        <VariableReferenceFields
          canRenderVariableReference={canRenderVariableReference}
          currentProvider={currentProvider}
          currentTool={currentTool}
          disableVariableInsertion={disableVariableInsertion}
          filterVar={getFilterVar(formState)}
          inPanel={inPanel}
          isBoolean={isBoolean}
          isString={isString}
          nodeId={nodeId}
          onManageInputField={onManageInputField}
          onValueChange={handleValueChange}
          onVariableSelectorChange={handleVariableSelectorChange}
          readOnly={readOnly}
          schema={schema}
          showManageInputField={showManageInputField}
          showVariableSelector={showVariableSelector}
          targetVarType={getTargetVarType(formState)}
          value={varInput}
          variable={variable}
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
        <SimpleSelect
          wrapperClassName="h-8 grow"
          disabled={readOnly}
          defaultValue={varInput?.value as string | undefined}
          items={staticSelectItems}
          onSelect={item => handleValueChange(item.value as string)}
          placeholder={placeholder?.[language] || placeholder?.en_US}
          renderOption={hasOptionIcon(visibleSelectOptions)
            ? ({ item }) => (
                <div className="flex items-center">
                  {item.icon && (
                    <img src={item.icon} alt="" className="mr-2 h-4 w-4" />
                  )}
                  <span>{item.name}</span>
                </div>
              )
            : undefined}
        />
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
        <SimpleSelect
          wrapperClassName="h-8 grow"
          disabled={readOnly || isLoadingOptions}
          defaultValue={varInput?.value as string | undefined}
          items={dynamicSelectItems}
          onSelect={item => handleValueChange(item.value as string)}
          placeholder={isLoadingOptions ? 'Loading...' : (placeholder?.[language] || placeholder?.en_US)}
          renderOption={({ item }) => (
            <div className="flex items-center">
              {item.icon && (
                <img src={item.icon} alt="" className="mr-2 h-4 w-4" />
              )}
              <span>{item.name}</span>
            </div>
          )}
        />
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
          value={jsonEditorValue}
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
          popupClassName="!w-[387px]"
          isAdvancedMode
          isInWorkflow
          value={varInput?.value}
          setModel={handleAppOrModelSelect}
          readonly={readOnly}
          scope={scope}
        />
      )}
    </div>
  )
}
export default FormInputItem
