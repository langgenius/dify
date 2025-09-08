'use client'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { type BaseResource, type BaseResourceProvider, type ResourceVarInputs, VarKindType } from '../types'
import type { CredentialFormSchema, FormOption } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { VarType } from '@/app/components/workflow/types'
import { useFetchDynamicOptions } from '@/service/use-plugins'

import type { ValueSelector, Var } from '@/app/components/workflow/types'
import FormInputTypeSwitch from './form-input-type-switch'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import Input from '@/app/components/base/input'
import { SimpleSelect } from '@/app/components/base/select'
import MixedVariableTextInput from './mixed-variable-text-input'
import FormInputBoolean from './form-input-boolean'
import AppSelector from '@/app/components/plugins/plugin-detail-panel/app-selector'
import ModelParameterModal from '@/app/components/plugins/plugin-detail-panel/model-selector'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import cn from '@/utils/classnames'
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react'
import { ChevronDownIcon } from '@heroicons/react/20/solid'
import { RiCheckLine } from '@remixicon/react'
type Props = {
  readOnly: boolean
  nodeId: string
  schema: CredentialFormSchema
  value: ResourceVarInputs
  onChange: (value: any) => void
  inPanel?: boolean
  currentResource?: BaseResource
  currentProvider?: BaseResourceProvider
  extraParams?: Record<string, any>
  providerType?: string
}

const FormInputItem: FC<Props> = ({
  readOnly,
  nodeId,
  schema,
  value,
  onChange,
  inPanel,
  currentResource,
  currentProvider,
  extraParams,
  providerType,
}) => {
  const language = useLanguage()
  const [dynamicOptions, setDynamicOptions] = useState<FormOption[] | null>(null)
  const [isLoadingOptions, setIsLoadingOptions] = useState(false)

  const {
    placeholder,
    variable,
    type,
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
  const isBoolean = type === FormTypeEnum.boolean
  const isSelect = type === FormTypeEnum.select
  const isDynamicSelect = type === FormTypeEnum.dynamicSelect
  const isAppSelector = type === FormTypeEnum.appSelector
  const isModelSelector = type === FormTypeEnum.modelSelector
  const showTypeSwitch = isNumber || isBoolean || isObject || isArray
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
    // else if (isSelect)
    //   return VarType.select
    // else if (isAppSelector)
    //   return VarType.appSelector
    // else if (isModelSelector)
    //   return VarType.modelSelector
    // else if (isBoolean)
    //   return VarType.boolean
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

  // Fetch dynamic options hook
  const { mutateAsync: fetchDynamicOptions } = useFetchDynamicOptions(
    currentProvider?.plugin_id || '',
    currentProvider?.name || '',
    currentResource?.name || '',
    variable || '',
    providerType,
    extraParams,
  )

  // Fetch dynamic options when component mounts or dependencies change
  useEffect(() => {
    const fetchOptions = async () => {
      if (isDynamicSelect && currentResource && currentProvider) {
        setIsLoadingOptions(true)
        try {
          const data = await fetchDynamicOptions()
          setDynamicOptions(data?.options || [])
        }
        catch (error) {
          console.error('Failed to fetch dynamic options:', error)
          setDynamicOptions([])
        }
        finally {
          setIsLoadingOptions(false)
        }
      }
    }

    fetchOptions()
  }, [isDynamicSelect, currentResource?.name, currentProvider?.name, variable, extraParams])

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

  return (
    <div className={cn('gap-1', !(isShowJSONEditor && isConstant) && 'flex')}>
      {showTypeSwitch && (
        <FormInputTypeSwitch value={varInput?.type || VarKindType.constant} onChange={handleTypeChange}/>
      )}
      {isString && (
        <MixedVariableTextInput
          readOnly={readOnly}
          value={varInput?.value as string || ''}
          onChange={handleValueChange}
          nodesOutputVars={availableVars}
          availableNodes={availableNodesWithParent}
        />
      )}
      {isNumber && isConstant && (
        <Input
          className='h-8 grow'
          type='number'
          value={Number.isNaN(varInput?.value) ? '' : varInput?.value}
          onChange={e => handleValueChange(e.target.value)}
          placeholder={placeholder?.[language] || placeholder?.en_US}
        />
      )}
      {isBoolean && (
        <FormInputBoolean
          value={varInput?.value as boolean}
          onChange={handleValueChange}
        />
      )}
      {isSelect && !isMultipleSelect && (
        <SimpleSelect
          wrapperClassName='h-8 grow'
          disabled={readOnly}
          defaultValue={varInput?.value}
          items={options.filter((option: { show_on: any[] }) => {
            if (option.show_on.length)
              return option.show_on.every(showOnItem => value[showOnItem.variable] === showOnItem.value)

            return true
          }).map((option: { value: any; label: { [x: string]: any; en_US: any }; icon?: string }) => ({
            value: option.value,
            name: option.label[language] || option.label.en_US,
            icon: option.icon,
          }))}
          onSelect={item => handleValueChange(item.value as string)}
          placeholder={placeholder?.[language] || placeholder?.en_US}
          renderOption={options.some((opt: any) => opt.icon) ? ({ item }) => (
            <div className="flex items-center">
              {item.icon && (
                <img src={item.icon} alt="" className="mr-2 h-4 w-4" />
              )}
              <span>{item.name}</span>
            </div>
          ) : undefined}
        />
      )}
      {isSelect && isMultipleSelect && (
        <Listbox
          multiple
          value={varInput?.value || []}
          onChange={handleValueChange}
          disabled={readOnly}
        >
          <div className="relative">
            <ListboxButton className="relative h-8 w-full cursor-pointer rounded-lg bg-components-input-bg-normal px-3 py-1.5 text-left text-sm focus:outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-white/75 focus-visible:ring-offset-2 focus-visible:ring-offset-orange-300">
              <span className="block truncate text-components-input-text-filled">
                {getSelectedLabels(varInput?.value) || placeholder?.[language] || placeholder?.en_US || 'Select options'}
              </span>
              <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                <ChevronDownIcon
                  className="h-4 w-4 text-text-tertiary"
                  aria-hidden="true"
                />
              </span>
            </ListboxButton>
            <ListboxOptions className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md bg-components-panel-bg-blur py-1 text-base shadow-lg ring-1 ring-black/5 focus:outline-none sm:text-sm">
              {options.filter((option: { show_on: any[] }) => {
                if (option.show_on?.length)
                  return option.show_on.every(showOnItem => value[showOnItem.variable] === showOnItem.value)
                return true
              }).map((option: { value: any; label: { [x: string]: any; en_US: any }; icon?: string }) => (
                <ListboxOption
                  key={option.value}
                  value={option.value}
                  className={({ focus }) =>
                    `relative cursor-pointer select-none py-2 pl-10 pr-4 ${
                      focus ? 'bg-state-base-hover text-text-secondary' : 'text-text-primary'
                    }`
                  }
                >
                  {({ selected }) => (
                    <>
                      <div className="flex items-center">
                        {option.icon && (
                          <img src={option.icon} alt="" className="mr-2 h-4 w-4" />
                        )}
                        <span className={`block truncate ${selected ? 'font-medium' : 'font-normal'}`}>
                          {option.label[language] || option.label.en_US}
                        </span>
                      </div>
                      {selected && (
                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-primary-600">
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
          wrapperClassName='h-8 grow'
          disabled={readOnly || isLoadingOptions}
          defaultValue={varInput?.value}
          items={(dynamicOptions || options || []).filter((option: { show_on?: any[] }) => {
            if (option.show_on?.length)
              return option.show_on.every(showOnItem => value[showOnItem.variable] === showOnItem.value)

            return true
          }).map((option: { value: any; label: { [x: string]: any; en_US: any }; icon?: string }) => ({
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
          <div className="relative">
            <ListboxButton className="relative h-8 w-full cursor-pointer rounded-lg bg-components-input-bg-normal px-3 py-1.5 text-left text-sm focus:outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-white/75 focus-visible:ring-offset-2 focus-visible:ring-offset-orange-300">
              <span className="block truncate text-components-input-text-filled">
                {isLoadingOptions
                  ? 'Loading...'
                  : getSelectedLabels(varInput?.value) || placeholder?.[language] || placeholder?.en_US || 'Select options'}
              </span>
              <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                <ChevronDownIcon
                  className="h-4 w-4 text-text-tertiary"
                  aria-hidden="true"
                />
              </span>
            </ListboxButton>
            <ListboxOptions className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md bg-components-panel-bg-blur py-1 text-base shadow-lg ring-1 ring-black/5 focus:outline-none sm:text-sm">
              {(dynamicOptions || options || []).filter((option: { show_on?: any[] }) => {
                if (option.show_on?.length)
                  return option.show_on.every(showOnItem => value[showOnItem.variable] === showOnItem.value)
                return true
              }).map((option: { value: any; label: { [x: string]: any; en_US: any }; icon?: string }) => (
                <ListboxOption
                  key={option.value}
                  value={option.value}
                  className={({ focus }) =>
                    `relative cursor-pointer select-none py-2 pl-10 pr-4 ${
                      focus ? 'bg-state-base-hover text-text-secondary' : 'text-text-primary'
                    }`
                  }
                >
                  {({ selected }) => (
                    <>
                      <div className="flex items-center">
                        {option.icon && (
                          <img src={option.icon} alt="" className="mr-2 h-4 w-4" />
                        )}
                        <span className={`block truncate ${selected ? 'font-medium' : 'font-normal'}`}>
                          {option.label[language] || option.label.en_US}
                        </span>
                      </div>
                      {selected && (
                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-primary-600">
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
        <div className='mt-1 w-full'>
          <CodeEditor
            title='JSON'
            value={varInput?.value as any}
            isExpand
            isInNode
            language={CodeLanguage.json}
            onChange={handleValueChange}
            className='w-full'
            placeholder={<div className='whitespace-pre'>{placeholder?.[language] || placeholder?.en_US}</div>}
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
          popupClassName='!w-[387px]'
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
          className='h-8 grow'
          readonly={readOnly}
          isShowNodeName
          nodeId={nodeId}
          value={varInput?.value || []}
          onChange={value => handleVariableSelectorChange(value, variable)}
          filterVar={getFilterVar()}
          schema={schema}
          valueTypePlaceHolder={targetVarType()}
          currentResource={currentResource}
          currentProvider={currentProvider}
        />
      )}
    </div>
  )
}
export default FormInputItem
