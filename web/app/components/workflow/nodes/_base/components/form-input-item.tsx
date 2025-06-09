'use client'
import type { FC } from 'react'
import type { ToolVarInputs } from '@/app/components/workflow/nodes/tool/types'
import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'
import { VarType } from '@/app/components/workflow/types'

import type { ValueSelector } from '@/app/components/workflow/types'
import FormInputTypeSwitch from './form-input-type-switch'
import Input from '@/app/components/base/input'
import { SimpleSelect } from '@/app/components/base/select'
import FormInputBoolean from './form-input-boolean'
import AppSelector from '@/app/components/plugins/plugin-detail-panel/app-selector'
import ModelParameterModal from '@/app/components/plugins/plugin-detail-panel/model-selector'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
// import cn from '@/utils/classnames'

type Props = {
  readOnly: boolean
  nodeId: string
  schema: CredentialFormSchema
  value: ToolVarInputs
  onChange: (value: any) => void
  onOpen?: (index: number) => void
  hideTypeSwitch?: boolean
}

const FormInputItem: FC<Props> = ({
  readOnly,
  nodeId,
  schema,
  value,
  onChange,
  hideTypeSwitch,
}) => {
  const {
    placeholder,
    variable,
    type,
    default: defaultValue,
    options,
    scope,
  } = schema as any
  const language = useLanguage()
  const varInput = value[variable]
  const isString = type === FormTypeEnum.textInput || type === FormTypeEnum.secretInput
  const isNumber = type === FormTypeEnum.textNumber
  const isObject = type === FormTypeEnum.object
  const isArray = type === FormTypeEnum.array
  const isBoolean = type === FormTypeEnum.boolean
  const isSelect = type === FormTypeEnum.select
  const isAppSelector = type === FormTypeEnum.appSelector
  const isModelSelector = type === FormTypeEnum.modelSelector
  const isFile = type === FormTypeEnum.file || type === FormTypeEnum.files

  const showTypeSwitch = isNumber || isObject || isArray

  const targetVarType = () => {
    if (isString)
      return VarType.string
    else if (isNumber)
      return VarType.number
    else if (isFile)
      return VarType.arrayFile
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
      return (varPayload: any) => varPayload.type === VarType.arrayObject
    return undefined
  }

  const getVarKindType = () => {
    if (isFile)
      return VarKindType.variable
    if (isSelect || isAppSelector || isModelSelector || isBoolean)
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
        value: newValue,
      },
    })
  }

  const handleVariableSelectorChange = (newValue: ValueSelector | string, variable: string) => {
    onChange({
      ...value,
      [variable]: {
        ...varInput,
        type: getVarKindType(),
        value: newValue || '',
      },
    })
  }

  return (
    <div className='flex gap-1'>
      {showTypeSwitch && !hideTypeSwitch && (
        <FormInputTypeSwitch value={varInput.type} onChange={handleTypeChange}/>
      )}
      {isNumber && varInput.type === VarKindType.constant && (
        <Input
          className='h-8 grow'
          type='number'
          value={varInput.value || ''}
          onChange={e => handleValueChange(e.target.value)}
          placeholder={placeholder?.[language] || placeholder?.en_US}
        />
      )}
      {isBoolean && (
        <FormInputBoolean
          value={varInput.value as boolean}
          onChange={handleValueChange}
        />
      )}
      {isSelect && (
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
      {isAppSelector && (
        <AppSelector
          disabled={readOnly}
          scope={scope || 'all'}
          value={varInput.value as any}
          onSelect={handleValueChange}
        />
      )}
      {isModelSelector && (
        <ModelParameterModal
          popupClassName='!w-[387px]'
          isAdvancedMode
          isInWorkflow
          value={varInput.value as any}
          setModel={handleValueChange}
          readonly={readOnly}
          scope={scope}
        />
      )}
      {varInput.type === VarKindType.variable && (
        <VarReferencePicker
          className='h-8 grow'
          readonly={readOnly}
          isShowNodeName
          nodeId={nodeId}
          value={varInput?.value || []}
          onChange={value => handleVariableSelectorChange(value, variable)}
          filterVar={getFilterVar()}
          schema={schema}
          valueTypePlaceHolder={targetVarType()}
        />
      )}
    </div>
  )
}
export default FormInputItem
