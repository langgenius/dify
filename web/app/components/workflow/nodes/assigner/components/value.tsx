'use client'
import type { FC } from 'react'
import React from 'react'
import { VarType } from '../../../types'
import type { AssignerSupportVarType, WriteMode } from '../types'
import StringValue from './string-value'
import NumberValue from './number-value'

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
  switch (type) {
    case VarType.string:
      return (
        <StringValue
          nodeId={nodeId}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
        />
      )
    case VarType.number:
      return (
        <NumberValue
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
