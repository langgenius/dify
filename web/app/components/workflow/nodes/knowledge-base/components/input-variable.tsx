import { memo } from 'react'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import { Field } from '@/app/components/workflow/nodes/_base/components/layout'
import type { ValueSelector } from '@/app/components/workflow/types'

type InputVariableProps = {
  nodeId: string
  inputVariable?: string[]
  onInputVariableChange: (inputVariable: string | ValueSelector) => void
  readonly?: boolean
}
const InputVariable = ({
  nodeId,
  inputVariable = [],
  onInputVariableChange,
  readonly = false,
}: InputVariableProps) => {
  return (
    <Field
      fieldTitleProps={{
        title: 'Input Variable',
        tooltip: 'Input Variable',
      }}
    >
      <VarReferencePicker
        nodeId={nodeId}
        isShowNodeName
        value={inputVariable}
        onChange={onInputVariableChange}
        readonly={readonly}
      />
    </Field>
  )
}
export default memo(InputVariable)
