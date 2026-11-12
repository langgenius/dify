import type { VariablePayload } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
import VariableLabel from './base/variable-label'
import { getVarBgColorInEditor } from './hooks'

type VariableLabelInEditorProps = {
  isSelected?: boolean
} & VariablePayload
const VariableLabelInEditor = ({
  isSelected,
  variables,
  errorMsg,
  warningMsg,
  ...rest
}: VariableLabelInEditorProps) => {
  const { hoverBorderColor, hoverBgColor, selectedBorderColor, selectedBgColor } =
    getVarBgColorInEditor(variables, !!errorMsg)
  const hasWarning = !!warningMsg && !errorMsg

  return (
    <VariableLabel
      className={cn(
        'h-4.5 space-x-px rounded-[5px] px-1 shadow-xs',
        !hasWarning && !isSelected && hoverBgColor,
        !hasWarning && !isSelected && hoverBorderColor,
        isSelected && 'border',
        !hasWarning && isSelected && selectedBorderColor,
        !hasWarning && isSelected && selectedBgColor,
        hasWarning && 'border border-state-warning-active bg-state-warning-hover',
      )}
      variables={variables}
      errorMsg={errorMsg}
      warningMsg={warningMsg}
      {...rest}
    />
  )
}

export default memo(VariableLabelInEditor)
