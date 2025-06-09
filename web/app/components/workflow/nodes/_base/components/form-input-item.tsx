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
    // scope,
  } = schema as any
  const language = useLanguage()
  const varInput = value[variable]
  const isString = type === FormTypeEnum.textInput || type === FormTypeEnum.secretInput
  const isNumber = type === FormTypeEnum.textNumber
  const isBoolean = type === FormTypeEnum.boolean
  const isSelect = type === FormTypeEnum.select
  const isFile = type === FormTypeEnum.file || type === FormTypeEnum.files
  const isAppSelector = type === FormTypeEnum.appSelector
  const isModelSelector = type === FormTypeEnum.modelSelector
  const isObject = type === FormTypeEnum.object
  const isArray = type === FormTypeEnum.array

  const showTypeSwitch = isNumber || isObject || isArray

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
        type: varInput.type,
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
      {isNumber && varInput.type === VarKindType.variable && (
        <VarReferencePicker
          className='h-8 grow'
          readonly={readOnly}
          isShowNodeName
          nodeId={nodeId}
          value={varInput?.value || []}
          onChange={value => handleVariableSelectorChange(value, variable)}
          filterVar={varPayload => varPayload.type === VarType.number}
          schema={schema}
          valueTypePlaceHolder={VarType.number}
        />
      )}
      {!isNumber && (
        <div className='h-8 grow rounded-lg bg-components-input-bg-normal'></div>
      )}
    </div>
  )
}
export default FormInputItem
