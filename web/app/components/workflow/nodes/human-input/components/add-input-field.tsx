'use client'
import InputField from '@/app/components/base/prompt-editor/plugins/hitl-input-block/input-field'
import type { FC } from 'react'
import React from 'react'
import type { FormInputItem } from '../types'

type Props = {
  nodeId: string
  onSave: (newPayload: FormInputItem) => void
  onCancel: () => void
}

const AddInputField: FC<Props> = ({
  nodeId,
  onSave,
  onCancel,
}) => {
  return (
    <InputField
      nodeId={nodeId}
      isEdit={false}
      onChange={onSave}
      onCancel={onCancel}
    />
  )
}
export default React.memo(AddInputField)
