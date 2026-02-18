import type { VariablePayload } from './types'
import { memo } from 'react'
import { cn } from '@/utils/classnames'
import VariableLabel from './base/variable-label'
import { useVarBgColorInEditor } from './hooks'

type VariableLabelInEditorProps = {
  isSelected?: boolean
} & VariablePayload
const VariableLabelInEditor = ({
  isSelected,
  variables,
  errorMsg,
  ...rest
}: VariableLabelInEditorProps) => {
  const {
    hoverBorderColor,
    hoverBgColor,
    selectedBorderColor,
    selectedBgColor,
  } = useVarBgColorInEditor(variables, !!errorMsg)

  return (
    <VariableLabel
      className={cn(
        'h-[18px] space-x-[1px] rounded-[5px] px-1 shadow-xs',
        !isSelected && hoverBgColor,
        !isSelected && hoverBorderColor,
        isSelected && 'border',
        isSelected && selectedBorderColor,
        isSelected && selectedBgColor,
      )}
      variables={variables}
      errorMsg={errorMsg}
      {...rest}
    />
  )
}

export default memo(VariableLabelInEditor)
