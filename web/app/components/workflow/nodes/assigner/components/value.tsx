'use client'
import type { FC } from 'react'
import React from 'react'
import { VarType } from '../../../types'
import { type AssignerSupportVarType, WriteMode } from '../types'
import StringValue from './string-value'
import NumberValue from './number-value'
import ObjectValue from './object-value'

type Props = {
  nodeId: string
  writeMode: WriteMode
  type: AssignerSupportVarType
  value: any
  onChange: (value: any) => void
  readOnly: boolean
}

const Value: FC<Props> = ({
  nodeId,
  type,
  writeMode,
  value,
  onChange,
  readOnly,
}) => {
  if (type === VarType.string || (type === VarType.arrayString && writeMode === WriteMode.Append)) {
    return (
      <StringValue
        nodeId={nodeId}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
      />
    )
  }
  if (type === VarType.number || (type === VarType.arrayNumber && writeMode === WriteMode.Append)) {
    return (
      <NumberValue
        nodeId={nodeId}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
      />
    )
  }

  if (type === VarType.object) {
    return (
      <ObjectValue
        nodeId={nodeId}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
      />
    )
  }
  return null
}
export default React.memo(Value)
