'use client'
import type { FC } from 'react'
import type { ToolVarInputs } from '@/app/components/workflow/nodes/tool/types'
import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'
import { VarType } from '@/app/components/workflow/types'

import type { ToolWithProvider, ValueSelector, Var } from '@/app/components/workflow/types'
import FormInputTypeSwitch from './form-input-type-switch'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import Input from '@/app/components/base/input'
import { SimpleSelect } from '@/app/components/base/select'
import MixedVariableTextInput from '@/app/components/workflow/nodes/tool/components/mixed-variable-text-input'
import FormInputBoolean from './form-input-boolean'
import AppSelector from '@/app/components/plugins/plugin-detail-panel/app-selector'
import ModelParameterModal from '@/app/components/plugins/plugin-detail-panel/model-selector'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import cn from '@/utils/classnames'
import type { Tool } from '@/app/components/tools/types'

type Props = {
  readOnly: boolean
  nodeId: string
  schema: CredentialFormSchema
  value: ToolVarInputs
  onChange: (value: any) => void
  inPanel?: boolean
  currentTool?: Tool
  currentProvider?: ToolWithProvider
  showManageInputField?: boolean
  onManageInputField?: () => void
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
}) => {
  const language = useLanguage()

  const {
    placeholder,
    variable,
    type,
    default: defaultValue,
    options,
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
  const isSelect = type === FormTypeEnum.select || type === FormTypeEnum.dynamicSelect
  const isAppSelector = type === FormTypeEnum.appSelector
  const isModelSelector = type === FormTypeEnum.modelSelector
  const showTypeSwitch = isNumber || isBoolean || isObject || isArray || isSelect
  const isConstant = varInput?.type === VarKindType.constant || !varInput?.type
  const showVariableSelector = isFile || varInput?.type === VarKindType.variable

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
    if (isSelect || isBoolean || isNumber || isArray || isObject)
      return VarKindType.constant
    if (isString)
      return VarKindType.mixed
  }

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
      {isBoolean && isConstant && (
        <FormInputBoolean
          value={varInput?.value as boolean}
          onChange={handleValueChange}
        />
      )}
      {isSelect && isConstant && (
        <SimpleSelect
          wrapperClassName='h-8 grow'
          disabled={readOnly}
          defaultValue={varInput?.value}
          items={options.filter((option: { show_on: any[] }) => {
            if (option.show_on.length)
              return option.show_on.every(showOnItem => value[showOnItem.variable] === showOnItem.value)

            return true
          }).map((option: { value: any; label: { [x: string]: any; en_US: any } }) => ({ value: option.value, name: option.label[language] || option.label.en_US }))}
          onSelect={item => handleValueChange(item.value as string)}
          placeholder={placeholder?.[language] || placeholder?.en_US}
        />
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
          currentTool={currentTool}
          currentProvider={currentProvider}
          isFilterFileVar={isBoolean}
        />
      )}
    </div>
  )
}
export default FormInputItem
