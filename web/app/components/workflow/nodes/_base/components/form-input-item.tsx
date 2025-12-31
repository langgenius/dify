'use client'
import type { FC } from 'react'
import type { ResourceVarInputs } from '../types'
import type { CredentialFormSchema, FormOption } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Event, Tool } from '@/app/components/tools/types'
import type { TriggerWithProvider } from '@/app/components/workflow/block-selector/types'
import type { ToolWithProvider, ValueSelector, Var } from '@/app/components/workflow/types'
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react'
import { ChevronDownIcon } from '@heroicons/react/20/solid'

import { RiCheckLine, RiLoader4Line } from '@remixicon/react'
import { useEffect, useMemo, useState } from 'react'
import CheckboxList from '@/app/components/base/checkbox-list'
import Input from '@/app/components/base/input'
import { SimpleSelect } from '@/app/components/base/select'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import AppSelector from '@/app/components/plugins/plugin-detail-panel/app-selector'
import ModelParameterModal from '@/app/components/plugins/plugin-detail-panel/model-selector'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import MixedVariableTextInput from '@/app/components/workflow/nodes/tool/components/mixed-variable-text-input'
import { VarType } from '@/app/components/workflow/types'
import { useFetchDynamicOptions } from '@/service/use-plugins'
import { useTriggerPluginDynamicOptions } from '@/service/use-triggers'
import { cn } from '@/utils/classnames'
import { VarKindType } from '../types'
import FormInputBoolean from './form-input-boolean'
import FormInputTypeSwitch from './form-input-type-switch'

type Props = {
  readOnly: boolean
  nodeId: string
  schema: CredentialFormSchema
  value: ResourceVarInputs
  onChange: (value: any) => void
  inPanel?: boolean
  currentTool?: Tool | Event
  currentProvider?: ToolWithProvider | TriggerWithProvider
  showManageInputField?: boolean
  onManageInputField?: () => void
  extraParams?: Record<string, any>
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
  const [toolsOptions, setToolsOptions] = useState<FormOption[] | null>(null)
  const [isLoadingToolsOptions, setIsLoadingToolsOptions] = useState(false)

  const {
    placeholder,
    variable,
    type,
    _type,
    default: defaultValue,
    options,
    multiple,
    scope,
  } = schema as any
  const varInput = value[variable]
  const isString = type === FormTypeEnum.textInput || type === FormTypeEnum.secretInput
  const isNumber = type === FormTypeEnum.textNumber
  const isObject = type === FormTypeEnum.object
  const isArray = type === FormTypeEnum.array
  const isShowJSONEditor = isObject || isArray
  const isFile = type === FormTypeEnum.file || type === FormTypeEnum.files
  const isBoolean = _type === FormTypeEnum.boolean
  const isCheckbox = _type === FormTypeEnum.checkbox
  const isSelect = type === FormTypeEnum.select
  const isDynamicSelect = type === FormTypeEnum.dynamicSelect
  const isAppSelector = type === FormTypeEnum.appSelector
  const isModelSelector = type === FormTypeEnum.modelSelector
  const showTypeSwitch = isNumber || isBoolean || isObject || isArray || isSelect
  const isConstant = varInput?.type === VarKindType.constant || !varInput?.type
  const showVariableSelector = isFile || varInput?.type === VarKindType.variable
  const isMultipleSelect = multiple && (isSelect || isDynamicSelect)

  const { availableVars, availableNodesWithParent } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar: false,
    filterVar: (varPayload: Var) => {
      return [VarType.string, VarType.number, VarType.secret].includes(varPayload.type)
    },
  })

  const targetVarType = () => {
    if (isString)
      return VarType.string
    else if (isNumber)
      return VarType.number
    else if (type === FormTypeEnum.files)
      return VarType.arrayFile
    else if (type === FormTypeEnum.file)
      return VarType.file
    else if (isSelect)
      return VarType.string
    // else if (isAppSelector)
    //   return VarType.appSelector
    // else if (isModelSelector)
    //   return VarType.modelSelector
    else if (isBoolean)
      return VarType.boolean
    else if (isObject)
      return VarType.object
    else if (isArray)
      return VarType.arrayObject
    else
      return VarType.string
  }

  const getFilterVar = () => {
    if (isNumber)
      return (varPayload: any) => varPayload.type === VarType.number
    else if (isString)
      return (varPayload: any) => [VarType.string, VarType.number, VarType.secret].includes(varPayload.type)
    else if (isFile)
      return (varPayload: any) => [VarType.file, VarType.arrayFile].includes(varPayload.type)
    else if (isBoolean)
      return (varPayload: any) => varPayload.type === VarType.boolean
    else if (isObject)
      return (varPayload: any) => varPayload.type === VarType.object
    else if (isArray)
      return (varPayload: any) => [VarType.array, VarType.arrayString, VarType.arrayNumber, VarType.arrayObject].includes(varPayload.type)
    return undefined
  }

  const getVarKindType = () => {
    if (isFile)
      return VarKindType.variable
    if (isSelect || isDynamicSelect || isBoolean || isNumber || isArray || isObject)
      return VarKindType.constant
    if (isString)
      return VarKindType.mixed
  }

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

  const handleValueChange = (newValue: any) => {
    onChange({
      ...value,
      [variable]: {
        ...varInput,
        type: getVarKindType(),
        value: isNumber ? Number.parseFloat(newValue) : newValue,
      },
    })
  }

  const getSelectedLabels = (selectedValues: any[]) => {
    if (!selectedValues || selectedValues.length === 0)
      return ''

    const optionsList = isDynamicSelect ? (dynamicOptions || options || []) : (options || [])
    const selectedOptions = optionsList.filter((opt: any) =>
      selectedValues.includes(opt.value),
    )

    if (selectedOptions.length <= 2) {
      return selectedOptions
        .map((opt: any) => opt.label?.[language] || opt.label?.en_US || opt.value)
        .join(', ')
    }

    return `${selectedOptions.length} selected`
  }

  const handleAppOrModelSelect = (newValue: any) => {
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
        value: newValue || '',
      },
    })
  }

  const availableCheckboxOptions = useMemo(() => (
    (options || []).filter((option: { show_on?: Array<{ variable: string, value: any }> }) => {
      if (option.show_on?.length)
        return option.show_on.every(showOnItem => value[showOnItem.variable]?.value === showOnItem.value || value[showOnItem.variable] === showOnItem.value)
      return true
    })
  ), [options, value])

  const checkboxListOptions = useMemo(() => (
    availableCheckboxOptions.map((option: { value: string, label: Record<string, string> }) => ({
      value: option.value,
      label: option.label?.[language] || option.label?.en_US || option.value,
    }))
  ), [availableCheckboxOptions, language])

  const checkboxListValue = useMemo(() => {
    let current: string[] = []
    if (Array.isArray(varInput?.value))
      current = varInput.value as string[]
    else if (typeof varInput?.value === 'string')
      current = [varInput.value as string]
    else if (Array.isArray(defaultValue))
      current = defaultValue as string[]

    const allowedValues = new Set(availableCheckboxOptions.map((option: { value: string }) => option.value))
    return current.filter(item => allowedValues.has(item))
  }, [varInput?.value, defaultValue, availableCheckboxOptions])

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
          value={Number.isNaN(varInput?.value) ? '' : varInput?.value}
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
          defaultValue={varInput?.value}
          items={options.filter((option: { show_on: any[] }) => {
            if (option.show_on.length)
              return option.show_on.every(showOnItem => value[showOnItem.variable] === showOnItem.value)

            return true
          }).map((option: { value: any, label: { [x: string]: any, en_US: any }, icon?: string }) => ({
            value: option.value,
            name: option.label[language] || option.label.en_US,
            icon: option.icon,
          }))}
          onSelect={item => handleValueChange(item.value as string)}
          placeholder={placeholder?.[language] || placeholder?.en_US}
          renderOption={options.some((opt: any) => opt.icon)
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
        <Listbox
          multiple
          value={varInput?.value || []}
          onChange={handleValueChange}
          disabled={readOnly}
        >
          <div className="group/simple-select relative h-8 grow">
            <ListboxButton className="flex h-full w-full cursor-pointer items-center rounded-lg border-0 bg-components-input-bg-normal pl-3 pr-10 focus-visible:bg-state-base-hover-alt focus-visible:outline-none group-hover/simple-select:bg-state-base-hover-alt sm:text-sm sm:leading-6">
              <span className={cn('system-sm-regular block truncate text-left', varInput?.value?.length > 0 ? 'text-components-input-text-filled' : 'text-components-input-text-placeholder')}>
                {getSelectedLabels(varInput?.value) || placeholder?.[language] || placeholder?.en_US || 'Select options'}
              </span>
              <span className="absolute inset-y-0 right-0 flex items-center pr-2">
                <ChevronDownIcon
                  className="h-4 w-4 text-text-quaternary group-hover/simple-select:text-text-secondary"
                  aria-hidden="true"
                />
              </span>
            </ListboxButton>
            <ListboxOptions className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur px-1 py-1 text-base shadow-lg backdrop-blur-sm focus:outline-none sm:text-sm">
              {options.filter((option: { show_on: any[] }) => {
                if (option.show_on?.length)
                  return option.show_on.every(showOnItem => value[showOnItem.variable] === showOnItem.value)
                return true
              }).map((option: { value: any, label: { [x: string]: any, en_US: any }, icon?: string }) => (
                <ListboxOption
                  key={option.value}
                  value={option.value}
                  className={({ focus }) =>
                    cn('relative cursor-pointer select-none rounded-lg py-2 pl-3 pr-9 text-text-secondary hover:bg-state-base-hover', focus && 'bg-state-base-hover')}
                >
                  {({ selected }) => (
                    <>
                      <div className="flex items-center">
                        {option.icon && (
                          <img src={option.icon} alt="" className="mr-2 h-4 w-4" />
                        )}
                        <span className={cn('block truncate', selected && 'font-normal')}>
                          {option.label[language] || option.label.en_US}
                        </span>
                      </div>
                      {selected && (
                        <span className="absolute inset-y-0 right-0 flex items-center pr-2 text-text-accent">
                          <RiCheckLine className="h-4 w-4" aria-hidden="true" />
                        </span>
                      )}
                    </>
                  )}
                </ListboxOption>
              ))}
            </ListboxOptions>
          </div>
        </Listbox>
      )}
      {isDynamicSelect && !isMultipleSelect && (
        <SimpleSelect
          wrapperClassName="h-8 grow"
          disabled={readOnly || isLoadingOptions}
          defaultValue={varInput?.value}
          items={(dynamicOptions || options || []).filter((option: { show_on?: any[] }) => {
            if (option.show_on?.length)
              return option.show_on.every(showOnItem => value[showOnItem.variable] === showOnItem.value)

            return true
          }).map((option: { value: any, label: { [x: string]: any, en_US: any }, icon?: string }) => ({
            value: option.value,
            name: option.label[language] || option.label.en_US,
            icon: option.icon,
          }))}
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
        <Listbox
          multiple
          value={varInput?.value || []}
          onChange={handleValueChange}
          disabled={readOnly || isLoadingOptions}
        >
          <div className="group/simple-select relative h-8 grow">
            <ListboxButton className="flex h-full w-full cursor-pointer items-center rounded-lg border-0 bg-components-input-bg-normal pl-3 pr-10 focus-visible:bg-state-base-hover-alt focus-visible:outline-none group-hover/simple-select:bg-state-base-hover-alt sm:text-sm sm:leading-6">
              <span className={cn('system-sm-regular block truncate text-left', isLoadingOptions
                ? 'text-components-input-text-placeholder'
                : varInput?.value?.length > 0 ? 'text-components-input-text-filled' : 'text-components-input-text-placeholder')}
              >
                {isLoadingOptions
                  ? 'Loading...'
                  : getSelectedLabels(varInput?.value) || placeholder?.[language] || placeholder?.en_US || 'Select options'}
              </span>
              <span className="absolute inset-y-0 right-0 flex items-center pr-2">
                {isLoadingOptions
                  ? (
                      <RiLoader4Line className="h-3.5 w-3.5 animate-spin text-text-secondary" />
                    )
                  : (
                      <ChevronDownIcon
                        className="h-4 w-4 text-text-quaternary group-hover/simple-select:text-text-secondary"
                        aria-hidden="true"
                      />
                    )}
              </span>
            </ListboxButton>
            <ListboxOptions className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur px-1 py-1 text-base shadow-lg backdrop-blur-sm focus:outline-none sm:text-sm">
              {(dynamicOptions || options || []).filter((option: { show_on?: any[] }) => {
                if (option.show_on?.length)
                  return option.show_on.every(showOnItem => value[showOnItem.variable] === showOnItem.value)
                return true
              }).map((option: { value: any, label: { [x: string]: any, en_US: any }, icon?: string }) => (
                <ListboxOption
                  key={option.value}
                  value={option.value}
                  className={({ focus }) =>
                    cn('relative cursor-pointer select-none rounded-lg py-2 pl-3 pr-9 text-text-secondary hover:bg-state-base-hover', focus && 'bg-state-base-hover')}
                >
                  {({ selected }) => (
                    <>
                      <div className="flex items-center">
                        {option.icon && (
                          <img src={option.icon} alt="" className="mr-2 h-4 w-4" />
                        )}
                        <span className={cn('block truncate', selected && 'font-normal')}>
                          {option.label[language] || option.label.en_US}
                        </span>
                      </div>
                      {selected && (
                        <span className="absolute inset-y-0 right-0 flex items-center pr-2 text-text-accent">
                          <RiCheckLine className="h-4 w-4" aria-hidden="true" />
                        </span>
                      )}
                    </>
                  )}
                </ListboxOption>
              ))}
            </ListboxOptions>
          </div>
        </Listbox>
      )}
      {isShowJSONEditor && isConstant && (
        <div className="mt-1 w-full">
          <CodeEditor
            title="JSON"
            value={varInput?.value as any}
            isExpand
            isInNode
            language={CodeLanguage.json}
            onChange={handleValueChange}
            className="w-full"
            placeholder={<div className="whitespace-pre">{placeholder?.[language] || placeholder?.en_US}</div>}
          />
        </div>
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
      {showVariableSelector && (
        <VarReferencePicker
          zIndex={inPanel ? 1000 : undefined}
          className="h-8 grow"
          readonly={readOnly}
          isShowNodeName
          nodeId={nodeId}
          value={varInput?.value || []}
          onChange={value => handleVariableSelectorChange(value, variable)}
          filterVar={getFilterVar()}
          schema={schema}
          valueTypePlaceHolder={targetVarType()}
          currentTool={currentTool}
          currentProvider={currentProvider}
          isFilterFileVar={isBoolean}
        />
      )}
    </div>
  )
}
export default FormInputItem
