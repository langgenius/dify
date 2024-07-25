'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import type { ValueSelector, Var } from '../../../types'
import { VarType } from '../../../types'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'

type Props = {
  nodeId: string
  value: any
  onChange: (value: any) => void
  readOnly: boolean
}

const NumberValue: FC<Props> = ({
  nodeId,
  value,
  onChange,
  readOnly,
}) => {
  const filterVar = (varPayload: Var) => {
    return [VarType.number].includes(varPayload.type)
  }

  const handleValueChange = useCallback((newValue: ValueSelector | string, varKindType: VarKindType) => {
    onChange({
      type: varKindType,
      value: newValue,
    })
  }, [onChange])

  return (
    <VarReferencePicker
      readonly={readOnly}
      isShowNodeName
      nodeId={nodeId}
      value={value?.type === VarKindType.constant ? (value?.value || '') : (value?.value || [])}
      onChange={handleValueChange}
      // onOpen={handleOpen(index)}
      isSupportConstantValue
      defaultVarKindType={value?.type}
      filterVar={filterVar}
      schema={{
        type: FormTypeEnum.textNumber,
      }}
    />
  )
}
export default React.memo(NumberValue)
