'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import type { KeyValue } from '@/app/components/workflow/nodes/http/types'
import KeyValueEdit from '@/app/components/workflow/nodes/http/components/key-value/key-value-edit'

type Props = {
  nodeId: string
  value: KeyValue[]
  onChange: (value: any) => void
  readOnly: boolean
}

const ObjectValue: FC<Props> = ({
  nodeId,
  value,
  onChange,
  readOnly,
}) => {
  const handleOnAdd = useCallback(() => {
    onChange([...value, { id: Date.now(), key: '', value: '' }])
  }, [onChange, value])
  return (
    <KeyValueEdit
      readonly={readOnly}
      nodeId={nodeId}
      list={value}
      onChange={onChange}
      onAdd={handleOnAdd}
      keyNotSupportVar
      insertVarTipToLeft
    />
  )
}
export default React.memo(ObjectValue)
