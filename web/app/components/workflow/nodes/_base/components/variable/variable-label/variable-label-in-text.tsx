import type { VariablePayload } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
import VariableLabel from './base/variable-label'

const VariableLabelInText = (variablePayload: VariablePayload) => {
  return (
    <VariableLabel
      className={cn(
        'h-[18px] space-x-px rounded-[5px] px-1 shadow-xs',
      )}
      {...variablePayload}
    />
  )
}

export default memo(VariableLabelInText)
