import type { VariablePayload } from './types'
import { memo } from 'react'
import VariableLabel from './base/variable-label'

const VariableLabelInSelect = (variablePayload: VariablePayload) => {
  return (
    <VariableLabel
      {...variablePayload}
    />
  )
}

export default memo(VariableLabelInSelect)
