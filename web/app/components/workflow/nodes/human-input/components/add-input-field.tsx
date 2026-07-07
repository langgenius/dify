'use client'
import type { FC } from 'react'
import type { FormInputItem } from '../types'
import * as React from 'react'
import InputField from '@/app/components/base/prompt-editor/plugins/hitl-input-block/input-field'

type Props = Readonly<{
  nodeId: string
  unavailableVariableNames?: string[]
  onSave: (newPayload: FormInputItem) => void
  onCancel: () => void
}>

const AddInputField: FC<Props> = ({
  nodeId,
  unavailableVariableNames,
  onSave,
  onCancel,
}) => {
  return (
    <InputField
      nodeId={nodeId}
      isEdit={false}
      unavailableVariableNames={unavailableVariableNames}
      onChange={onSave}
      onCancel={onCancel}
    />
  )
}
export default React.memo(AddInputField)
