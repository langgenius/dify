import { memo } from 'react'
import type { VariablePayload } from './types'
import VariableLabel from './base/variable-label'
import cn from '@/utils/classnames'

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
