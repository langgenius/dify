import type { VariablePayload } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
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
        'h-[18px] space-x-px rounded-[5px] px-1 shadow-xs',
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
