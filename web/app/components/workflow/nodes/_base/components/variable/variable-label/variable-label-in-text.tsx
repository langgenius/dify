import type { VariablePayload } from './types'
import { memo } from 'react'
import { cn } from '@/utils/classnames'
import VariableLabel from './base/variable-label'

const VariableLabelInText = (variablePayload: VariablePayload) => {
  return (
    <VariableLabel
      className={cn(
        'h-[18px] space-x-[1px] rounded-[5px] px-1 shadow-xs',
      )}
      {...variablePayload}
    />
  )
}

export default memo(VariableLabelInText)
